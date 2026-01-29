/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { createClient } from '@vercel/kv';

export const config = {
  runtime: 'edge',
};

// ===== ERROR CLASSIFICATION SYSTEM =====
interface LuaErrorClassification {
    message: string;
    type: 'TIMEOUT' | 'REDIS_UNAVAILABLE' | 'INVALID_JSON' | 'SCRIPT_ERROR' | 'UNKNOWN';
    statusCode: 400 | 500 | 503;
    isRetryable: boolean;
}

function classifyLuaError(error: any): LuaErrorClassification {
    const msg = (error.message || '').toLowerCase();
    const code = error.code || '';
    
    // Timeouts (retryable) - HTTP 503 Service Unavailable
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout') || code === 'ETIMEDOUT') {
        return {
            message: 'TIMEOUT: Script Lua excedeu tempo limite (retryable)',
            type: 'TIMEOUT',
            statusCode: 503,
            isRetryable: true
        };
    }
    
    // Redis indisponível (retryable) - HTTP 503
    if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('refused') || 
        msg.includes('connection') || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
        return {
            message: 'REDIS_UNAVAILABLE: Serviço indisponível (retryable)',
            type: 'REDIS_UNAVAILABLE',
            statusCode: 503,
            isRetryable: true
        };
    }
    
    // Erro de sintaxe Lua (não-retryable) - HTTP 500
    if (msg.includes('syntax error') || msg.includes('attempt to') || msg.includes('unexpected symbol')) {
        return {
            message: 'SCRIPT_ERROR: Erro no script Lua (código permanente)',
            type: 'SCRIPT_ERROR',
            statusCode: 500,
            isRetryable: false
        };
    }
    
    // JSON inválido (não-retryable) - HTTP 400
    if (msg.includes('json') || msg.includes('decode') || msg.includes('invalid')) {
        return {
            message: 'INVALID_JSON: Payload JSON malformado (não-retryable)',
            type: 'INVALID_JSON',
            statusCode: 400,
            isRetryable: false
        };
    }
    
    // Desconhecido - assuma que é retryable para ser seguro
    return {
        message: `UNKNOWN_LUA_ERROR: ${error.message || 'sem detalhes'}`,
        type: 'UNKNOWN',
        statusCode: 500,
        isRetryable: true
    };
}

const LUA_SHARDED_UPDATE = `
local key = KEYS[1]
local newTs = tonumber(ARGV[1])
local shardsJson = ARGV[2]

local currentTs = tonumber(redis.call("HGET", key, "lastModified") or 0)

-- Optimistic Concurrency Control
if newTs < currentTs then
    local all = redis.call("HGETALL", key)
    return { "CONFLICT", all }
end

-- Robust JSON Parsing with detailed error info
local status, shards = pcall(cjson.decode, shardsJson)
if not status then
    -- Return more detailed error message including what went wrong
    return { "ERROR", "JSON_PARSE_ERROR:" .. tostring(shards) }
end

-- Validate shards is a table
if type(shards) ~= "table" then
    return { "ERROR", "INVALID_SHARDS_TYPE:" .. type(shards) }
end

-- Validate shard count for safety
local shardCount = 0
for k, v in pairs(shards) do
    shardCount = shardCount + 1
    if shardCount > 1000 then
        return { "ERROR", "TOO_MANY_SHARDS:" .. shardCount }
    end
    if type(v) ~= "string" then
        return { "ERROR", "SHARD_NOT_STRING:" .. tostring(k) }
    end
end

-- Atomic Shard Update
for shardName, shardData in pairs(shards) do
    if type(shardData) == "string" then
        redis.call("HSET", key, shardName, shardData)
    end
end

redis.call("HSET", key, "lastModified", newTs)
return { "OK" }
`;

const HEADERS_BASE = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*', 
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Key-Hash, Authorization',
};

async function sha256(message: string) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req: Request) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS_BASE });

    const dbUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const dbToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!dbUrl || !dbToken) {
         return new Response(JSON.stringify({ error: 'Server Config Error' }), { status: 500, headers: HEADERS_BASE });
    }

    const kv = createClient({ url: dbUrl, token: dbToken });

    try {
        let keyHash = req.headers.get('x-sync-key-hash');
        if (!keyHash) {
            const authHeader = req.headers.get('Authorization');
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const rawKey = authHeader.replace('Bearer ', '').trim();
                if (rawKey.length >= 8) keyHash = await sha256(rawKey);
            }
        }

        if (!keyHash || !/^[a-f0-9]{64}$/i.test(keyHash)) {
            return new Response(JSON.stringify({ error: 'Auth Required' }), { status: 401, headers: HEADERS_BASE });
        }
        
        const dataKey = `sync_v3:${keyHash}`;

        if (req.method === 'GET') {
            const allData = await kv.hgetall(dataKey);
            if (!allData) return new Response('null', { status: 200, headers: HEADERS_BASE });
            return new Response(JSON.stringify(allData), { status: 200, headers: HEADERS_BASE });
        }

        if (req.method === 'POST') {
            const body = await req.json();
            const { lastModified, shards } = body;

            if (lastModified === undefined) {
                return new Response(JSON.stringify({ error: 'Missing lastModified' }), { status: 400, headers: HEADERS_BASE });
            }
            if (!shards || typeof shards !== 'object') {
                return new Response(JSON.stringify({ error: 'Invalid or missing shards' }), { status: 400, headers: HEADERS_BASE });
            }

            // Pre-validate shards before sending to Lua
            const shardsStr = JSON.stringify(shards);
            if (shardsStr.length > 10 * 1024 * 1024) { // 10MB limit
                return new Response(JSON.stringify({ error: 'Payload too large' }), { status: 413, headers: HEADERS_BASE });
            }

            let result: any;
            try {
                const startTime = Date.now();
                result = await kv.eval(LUA_SHARDED_UPDATE, [dataKey], [String(lastModified), shardsStr]) as [string, any?];
                const duration = Date.now() - startTime;
                
                // Log sucesso com contexto
                console.info("[Sync OK]", {
                    durationMs: duration,
                    payloadSize: shardsStr.length,
                    shardCount: Object.keys(shards).length
                });
                
            } catch (luaError: any) {
                const errorDetails = {
                    message: luaError.message,
                    name: luaError.name,
                    code: luaError.code,
                    payloadSize: shardsStr.length,
                    shardCount: Object.keys(shards).length,
                    timestamp: new Date().toISOString()
                };
                
                console.error("[Sync Lua Error]", errorDetails);
                
                // Classificar o tipo de erro com mais precisão
                const errorType = classifyLuaError(errorDetails);
                
                return new Response(JSON.stringify({ 
                    error: errorType.message,
                    type: errorType.type,
                    details: errorDetails
                }), { 
                    status: errorType.statusCode,
                    headers: HEADERS_BASE 
                });
            }
            
            if (result[0] === 'OK') {
                console.info("[Sync Result] Success");
                return new Response('{"success":true}', { status: 200, headers: HEADERS_BASE });
            }
            
            if (result[0] === 'CONFLICT') {
                console.info("[Sync Result] Conflict detected");
                const rawList = result[1] as string[];
                const conflictShards: Record<string, string> = {};
                for (let i = 0; i < rawList.length; i += 2) {
                    conflictShards[rawList[i]] = rawList[i+1];
                }
                return new Response(JSON.stringify(conflictShards), { status: 409, headers: HEADERS_BASE });
            }
            
            // Lua script returned ERROR status
            const errorMsg = result[1] || 'Lua execution error';
            const detailedError = typeof errorMsg === 'string' ? errorMsg : String(errorMsg);
            console.error("[Sync Lua Result ERROR]", detailedError);
            
            // Classify error returned from Lua script to determine if retryable
            const isJsonError = detailedError.includes('JSON_PARSE_ERROR');
            const isValidationError = detailedError.includes('INVALID_SHARDS_TYPE') || 
                                     detailedError.includes('SHARD_NOT_STRING') ||
                                     detailedError.includes('TOO_MANY_SHARDS');
            
            // JSON parse and validation errors are permanent (client-side fix needed)
            const statusCode = (isJsonError || isValidationError) ? 400 : 500;
            
            return new Response(JSON.stringify({ 
                error: detailedError,
                isRetryable: statusCode === 500
            }), { 
                status: statusCode, 
                headers: HEADERS_BASE 
            });
        }

        return new Response(null, { status: 405 });
    } catch (error: any) {
        console.error("[Sync] KV Error:", error);
        return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), { status: 500, headers: HEADERS_BASE });
    }
}