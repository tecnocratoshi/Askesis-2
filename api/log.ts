/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { Redis } from '@upstash/redis';

export const config = {
  runtime: 'edge',
};

const HEADERS_BASE = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const MAX_BODY_BYTES = 2048;
const TTL_SECONDS = 60 * 60 * 24 * 7;

function clamp(value: unknown, maxLen: number): string {
  if (!value) return '';
  const str = String(value);
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS_BASE });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: HEADERS_BASE });

  const dbUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const dbToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!dbUrl || !dbToken) {
    return new Response(JSON.stringify({ error: 'Server Config Error' }), { status: 500, headers: HEADERS_BASE });
  }

  const contentLength = Number(req.headers.get('content-length') || '0');
  if (contentLength && contentLength > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), { status: 413, headers: HEADERS_BASE });
  }

  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: HEADERS_BASE });
  }

  const safe = {
    type: clamp(payload?.type, 40),
    name: clamp(payload?.name, 80),
    message: clamp(payload?.message, 300),
    stack: clamp(payload?.stack, 800),
    path: clamp(payload?.path, 120),
    ts: Number(payload?.ts) || Date.now(),
    context: payload?.context && typeof payload.context === 'object' ? payload.context : undefined
  };

  const kv = new Redis({ url: dbUrl, token: dbToken });
  const key = `telemetry:error:${safe.ts}:${Math.random().toString(36).slice(2)}`;

  try {
    await kv.set(key, JSON.stringify(safe), { ex: TTL_SECONDS });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Storage Error' }), { status: 500, headers: HEADERS_BASE });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: HEADERS_BASE });
}
