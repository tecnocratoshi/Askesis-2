/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { createClient } from '@vercel/kv';

export const config = {
  runtime: 'edge',
};

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
                result = await kv.eval(LUA_SHARDED_UPDATE, [dataKey], [String(lastModified), shardsStr]) as [string, any?];
            } catch (luaError: any) {
                console.error("Lua execution error:", luaError);
                return new Response(JSON.stringify({ error: `Lua execution failed: ${luaError.message}` }), { status: 500, headers: HEADERS_BASE });
            }
            
            if (result[0] === 'OK') return new Response('{"success":true}', { status: 200, headers: HEADERS_BASE });
            
            if (result[0] === 'CONFLICT') {
                const rawList = result[1] as string[];
                const conflictShards: Record<string, string> = {};
                for (let i = 0; i < rawList.length; i += 2) {
                    conflictShards[rawList[i]] = rawList[i+1];
                }
                return new Response(JSON.stringify(conflictShards), { status: 409, headers: HEADERS_BASE });
            }
            
            // Improved error messages from Lua execution
            const errorMsg = result[1] || 'Lua execution error';
            const detailedError = typeof errorMsg === 'string' ? errorMsg : String(errorMsg);
            console.error("Lua error details:", detailedError);
            return new Response(JSON.stringify({ error: detailedError }), { status: 400, headers: HEADERS_BASE });
        }

        return new Response(null, { status: 405 });
    } catch (error: any) {
        console.error("KV Error:", error);
        return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), { status: 500, headers: HEADERS_BASE });
    }
}