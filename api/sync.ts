/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { createClient } from '@vercel/kv';

export const config = {
  runtime: 'edge',
};

const MAX_PAYLOAD_SIZE = 1.5 * 1024 * 1024; // 1.5MB total hash limit

/**
 * LUA ATOMIC SHARD UPDATE:
 * 1. Verifica consistência temporal (Optimistic Locking) via field 'lastModified'.
 * 2. Se OK, aplica HSET apenas nos shards enviados no payload.
 * 3. Se CONFLITO, retorna todos os shards atuais para merge no cliente.
 */
const LUA_SHARDED_UPDATE = `
local key = KEYS[1]
local newTs = tonumber(ARGV[1])
local shardsJson = ARGV[2]

local currentTs = tonumber(redis.call("HGET", key, "lastModified") or 0)

if newTs < currentTs then
    return { "CONFLICT", redis.call("HGETALL", key) }
end

local shards = cjson.decode(shardsJson)
for shardName, shardData in pairs(shards) do
    redis.call("HSET", key, shardName, shardData)
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
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: HEADERS_BASE });
        }
        
        // Versão 3: Sharded Storage (Hashes)
        const dataKey = `sync_v3:${keyHash}`;

        if (req.method === 'GET') {
            const allData = await kv.hgetall(dataKey);
            if (!allData) return new Response('null', { status: 200, headers: HEADERS_BASE });
            
            // Reconstroi o objeto a partir do Hash do Redis
            return new Response(JSON.stringify(allData), { status: 200, headers: HEADERS_BASE });
        }

        if (req.method === 'POST') {
            const body = await req.json();
            const { lastModified, shards } = body;

            if (!lastModified || !shards) {
                return new Response(JSON.stringify({ error: 'Invalid Payload' }), { status: 400, headers: HEADERS_BASE });
            }

            const result = await kv.eval(LUA_SHARDED_UPDATE, [dataKey], [String(lastModified), JSON.stringify(shards)]) as [string, any?];
            
            if (result[0] === 'OK') return new Response('{"success":true}', { status: 200, headers: HEADERS_BASE });
            if (result[0] === 'CONFLICT') {
                // Se houver conflito, retornamos o estado atual completo (shards) para o cliente fazer o Smart Merge
                return new Response(JSON.stringify(result[1]), { status: 409, headers: HEADERS_BASE });
            }
            return new Response(JSON.stringify({ error: result[1] }), { status: 400, headers: HEADERS_BASE });
        }

        return new Response(null, { status: 405 });
    } catch (error: any) {
        console.error("KV Error:", error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500, headers: HEADERS_BASE });
    }
}