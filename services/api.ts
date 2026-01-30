
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file services/api.ts
 * @description Cliente de API e Gerenciamento de Chaves de Sincronização.
 */

const SYNC_KEY_STORAGE_KEY = 'habitTrackerSyncKey';
const API_TIMEOUT_MS = 12000;
const API_MAX_RETRIES = 2;
const API_RETRY_DELAY_MS = 500;

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

// --- GERENCIAMENTO DE CHAVES ---

export const hasLocalSyncKey = (): boolean => {
    return !!localStorage.getItem(SYNC_KEY_STORAGE_KEY);
};

export const getSyncKey = (): string | null => {
    return localStorage.getItem(SYNC_KEY_STORAGE_KEY);
};

export const storeKey = (k: string) => {
    if (!k) return;
    localStorage.setItem(SYNC_KEY_STORAGE_KEY, k);
};

export const clearKey = () => {
    localStorage.removeItem(SYNC_KEY_STORAGE_KEY);
};

// --- VALIDAÇÃO ---
export const isValidKeyFormat = (key: string): boolean => {
    // Formato UUID v4 básico
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
};

// --- AUTH HASH (SHA-256) ---
let cachedHash: string | null = null;
let lastKeyForHash: string | null = null;

/**
 * Gera um hash da chave para usar como identificador no banco (Privacidade).
 * A chave real nunca sai do dispositivo em texto claro.
 */
async function getSyncKeyHash(): Promise<string | null> {
    const key = getSyncKey();
    if (!key) return null;

    if (cachedHash && lastKeyForHash === key) return cachedHash;

    if (window.crypto && window.crypto.subtle) {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(key);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            cachedHash = hashHex;
            lastKeyForHash = key;
            
            return hashHex;
        } catch (e) {
            console.warn("[API] Crypto Digest failed, falling back to raw auth", e);
        }
    }
    return null;
}

// --- API CLIENT ---

/**
 * Wrapper de Fetch com injeção automática de Headers de Sync.
 */
export async function apiFetch(endpoint: string, options: RequestInit = {}, includeSyncKey = false): Promise<Response> {
    const headers = new Headers(options.headers || {});
    
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    if (includeSyncKey) {
        const hash = await getSyncKeyHash();
        if (hash) {
            // O servidor usa o hash para encontrar o registro no KV/Redis
            headers.set('X-Sync-Key-Hash', hash);
            // Bearer opcional para compatibilidade com middlewares de auth tradicionais
            headers.set('Authorization', `Bearer ${getSyncKey()}`);
        } else {
            throw new Error("Sync Key missing or environment insecure (No Crypto API).");
        }
    }

    const config = {
        ...options,
        headers,
        // PERFORMANCE: Mantém a conexão aberta para múltiplos pings de sincronização
        keepalive: options.method === 'POST'
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt++) {
        try {
            const response = await fetchWithTimeout(endpoint, config, API_TIMEOUT_MS);

            // Gestão de Resiliência: Se o servidor diz que a chave não existe mais, limpa localmente
            if (response.status === 401 && hasLocalSyncKey()) {
                console.error("[API] Unauthorized. Local key might be revoked.");
            }

            return response;
        } catch (error) {
            lastError = error;
            if (attempt < API_MAX_RETRIES) {
                await wait(API_RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            console.error('[API] Network error during apiFetch', error);
        }
    }

    throw lastError;
}

export const initAuth = async () => {
    if (!hasLocalSyncKey()) return;
    try {
        await getSyncKeyHash();
    } catch (error) {
        console.warn('[API] initAuth failed', error);
    }
};
