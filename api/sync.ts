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

if not newTs then
    return { "ERROR", "INVALID_TS" }
end

-- Optimistic Concurrency Control
if newTs < currentTs then
    local all = redis.call("HGETALL", key)
    return { "CONFLICT", all }
end

-- Robust JSON Parsing
local status, shards = pcall(cjson.decode, shardsJson)
if not status then
    return { "ERROR", "INVALID_JSON" }
end

-- Atomic Shard Update
for shardName, shardData in pairs(shards) do
    if type(shardData) == "string" then
        redis.call("HSET", key, shardName, shardData)
    else
        return { "ERROR", "INVALID_SHARD_TYPE", shardName, type(shardData) }
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

            const result = await kv.eval(LUA_SHARDED_UPDATE, [dataKey], [String(lastModified), JSON.stringify(shards)]) as [string, any?];
            
            if (result[0] === 'OK') return new Response('{"success":true}', { status: 200, headers: HEADERS_BASE });
            
            if (result[0] === 'CONFLICT') {
                const rawList = result[1] as string[];
                const conflictShards: Record<string, string> = {};
                for (let i = 0; i < rawList.length; i += 2) {
                    conflictShards[rawList[i]] = rawList[i+1];
                }
                return new Response(JSON.stringify(conflictShards), { status: 409, headers: HEADERS_BASE });
            }
            
            return new Response(JSON.stringify({ error: 'Lua Execution Error', code: result[1] || 'UNKNOWN', detail: result[2], detailType: result[3] }), { status: 400, headers: HEADERS_BASE });
        }

        return new Response(null, { status: 405 });
    } catch (error: any) {
        console.error("KV Error:", error);
        return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), { status: 500, headers: HEADERS_BASE });
    }
}