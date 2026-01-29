/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file cloud.ts
 * @description Orquestrador de Sincronização e Ponte para Web Workers (Main Thread Client).
 */

import { AppState, state, getPersistableState } from '../state';
import { loadState, persistStateLocally } from './persistence';
import { pushToOneSignal, generateUUID } from '../utils';
import { ui } from '../render/ui';
import { t } from '../i18n';
import { hasLocalSyncKey, getSyncKey, apiFetch } from './api';
import { renderApp, updateNotificationUI } from '../render';
import { mergeStates } from './dataMerge';
import { HabitService } from './HabitService';

// PERFORMANCE: Debounce para evitar salvar na nuvem a cada pequena alteração
let syncTimeout: number | null = null;
const DEBOUNCE_DELAY = 2000; 
const HASH_STORAGE_KEY = 'askesis_sync_hashes';
const TELEMETRY_STORAGE_KEY = 'askesis_sync_telemetry';

// ===== RETRY & TELEMETRY SYSTEM =====
interface SyncRetryConfig {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffFactor: number;
}

interface SyncTelemetry {
    totalSyncs: number;
    successfulSyncs: number;
    failedSyncs: number;
    totalPayloadBytes: number;
    maxPayloadBytes: number;
    avgPayloadBytes: number;
    errorFrequency: Record<string, number>;
    lastError: { message: string; timestamp: number; } | null;
}

const RETRY_CONFIG: SyncRetryConfig = {
    maxAttempts: 5,
    initialDelayMs: 1000,      // 1 segundo
    maxDelayMs: 32000,         // 32 segundos
    backoffFactor: 2           // Dobra a cada tentativa
};

let syncRetryAttempt = 0;
let syncTelemetry: SyncTelemetry = loadTelemetry();

function loadTelemetry(): SyncTelemetry {
    try {
        const raw = localStorage.getItem(TELEMETRY_STORAGE_KEY);
        if (raw) {
            const data = JSON.parse(raw) as SyncTelemetry;
            // Resetar contadores diários se necessário
            if (new Date().toDateString() !== sessionStorage.getItem('teleDay')) {
                data.failedSyncs = 0;
                data.errorFrequency = {};
                sessionStorage.setItem('teleDay', new Date().toDateString());
            }
            return data;
        }
    } catch (e) {
        console.warn("[Telemetry] Falha ao carregar dados", e);
    }
    return {
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        totalPayloadBytes: 0,
        maxPayloadBytes: 0,
        avgPayloadBytes: 0,
        errorFrequency: {},
        lastError: null
    };
}

function saveTelemetry() {
    try {
        localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(syncTelemetry));
    } catch (e) {
        console.warn("[Telemetry] Falha ao salvar dados", e);
    }
}

function recordSyncAttempt(payloadSize: number, success: boolean, error?: string) {
    syncTelemetry.totalSyncs++;
    
    if (success) {
        syncTelemetry.successfulSyncs++;
        // Reset retry counter on success
        syncRetryAttempt = 0;
    } else {
        syncTelemetry.failedSyncs++;
        if (error) {
            const errorType = error.split(':')[0] || 'UNKNOWN_ERROR';
            syncTelemetry.errorFrequency[errorType] = (syncTelemetry.errorFrequency[errorType] || 0) + 1;
            syncTelemetry.lastError = { message: error, timestamp: Date.now() };
        }
    }
    
    // Atualizar estatísticas de payload (mesmo em erro, para rastrear tentativas falhadas)
    if (payloadSize > 0) {
        syncTelemetry.totalPayloadBytes += payloadSize;
        if (payloadSize > syncTelemetry.maxPayloadBytes) {
            syncTelemetry.maxPayloadBytes = payloadSize;
        }
        syncTelemetry.avgPayloadBytes = Math.round(
            syncTelemetry.totalPayloadBytes / Math.max(1, syncTelemetry.totalSyncs)
        );
    }
    
    saveTelemetry();
    
    // Log para debugging
    console.debug('[Sync Telemetry]', {
        sync: `${syncTelemetry.successfulSyncs}/${syncTelemetry.totalSyncs}`,
        payload: `${payloadSize} bytes`,
        error: error || 'none'
    });
}
        payload: `${payloadSize} bytes`,
        error: error || 'none'
    });
}

function calculateRetryDelay(attemptNumber: number): number {
    const exponentialDelay = RETRY_CONFIG.initialDelayMs * 
        Math.pow(RETRY_CONFIG.backoffFactor, attemptNumber);
    const delayWithJitter = exponentialDelay * (0.5 + Math.random() * 0.5); // ±50% jitter
    return Math.min(delayWithJitter, RETRY_CONFIG.maxDelayMs);
}

function getSyncHealthStatus() {
    const successRate = syncTelemetry.totalSyncs > 0 
        ? (syncTelemetry.successfulSyncs / syncTelemetry.totalSyncs * 100).toFixed(1)
        : 'N/A';
    return {
        successRate: `${successRate}%`,
        totalAttempts: syncTelemetry.totalSyncs,
        lastError: syncTelemetry.lastError,
        avgPayloadSize: `${syncTelemetry.avgPayloadBytes} bytes`,
        topErrors: Object.entries(syncTelemetry.errorFrequency)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 3)
            .map(([err, count]) => `${err}(${count})`)
    };
}

let isSyncInProgress = false;
let pendingSyncState: AppState | null = null;

// --- WORKER INFRASTRUCTURE ---
let syncWorker: Worker | null = null;
const workerCallbacks = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>();

function getWorker(): Worker {
    if (!syncWorker) {
        syncWorker = new Worker('./sync-worker.js', { type: 'module' });
        syncWorker.onmessage = (e) => {
            const { id, status, result, error } = e.data;
            const callback = workerCallbacks.get(id);
            if (callback) {
                if (status === 'success') {
                    callback.resolve(result);
                } else {
                    callback.reject(new Error(error));
                }
                workerCallbacks.delete(id);
            }
        };
        
        syncWorker.onerror = (e) => {
            console.error("Critical Worker Error:", e);
        };
    }
    return syncWorker;
}

export function runWorkerTask<T>(type: 'encrypt' | 'decrypt' | 'build-ai-prompt' | 'build-quote-analysis-prompt' | 'prune-habit' | 'archive', payload: any, key?: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const id = generateUUID();
        workerCallbacks.set(id, { resolve, reject });
        getWorker().postMessage({ id, type, payload, key });
    });
}

function splitIntoShards(appState: AppState): Record<string, any> {
    const shards: Record<string, any> = {};
    // Core: Dados leves e críticos para o boot
    shards['core'] = {
        version: appState.version,
        habits: appState.habits,
        dailyData: appState.dailyData,
        dailyDiagnoses: appState.dailyDiagnoses,
        notificationsShown: appState.notificationsShown,
        hasOnboarded: appState.hasOnboarded,
        quoteState: appState.quoteState
    };
    
    // Logs: Shards granulares mensais (Bitmasks)
    // Usa o cache do HabitService para obter os dados já agrupados
    const groupedLogs = HabitService.getLogsGroupedByMonth();
    for (const month in groupedLogs) { 
        shards[`logs:${month}`] = groupedLogs[month]; 
    }
    
    // Arquivos: Shards anuais (Dados frios)
    for (const year in appState.archives) { 
        shards[`archive:${year}`] = appState.archives[year]; 
    }
    
    return shards;
}

// PERF: Carrega hashes do localStorage para evitar re-upload no boot (Cold Start Optimization)
const lastSyncedHashes: Map<string, string> = (() => {
    try {
        const raw = localStorage.getItem(HASH_STORAGE_KEY);
        if (raw) return new Map(JSON.parse(raw));
    } catch (e) {
        console.warn("[Sync] Falha ao carregar cache de hashes", e);
    }
    return new Map();
})();

function persistHashCache() {
    try {
        localStorage.setItem(HASH_STORAGE_KEY, JSON.stringify(Array.from(lastSyncedHashes.entries())));
    } catch (e) {
        console.error("[Sync] Falha ao salvar cache de hashes", e);
    }
}

export function clearSyncHashCache() {
    lastSyncedHashes.clear();
    localStorage.removeItem(HASH_STORAGE_KEY);
    console.debug("[Sync] Hash cache cleared.");
}

function murmurHash3(key: string, seed: number = 0): string {
    let remainder = key.length & 3, bytes = key.length - remainder, h1 = seed, c1 = 0xcc9e2d51, c2 = 0x1b873593, i = 0;
    while (i < bytes) {
        let k1 = ((key.charCodeAt(i) & 0xff)) | ((key.charCodeAt(++i) & 0xff) << 8) | ((key.charCodeAt(++i) & 0xff) << 16) | ((key.charCodeAt(++i) & 0xff) << 24);
        ++i;
        k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;
        h1 ^= k1; h1 = (h1 << 13) | (h1 >>> 19); h1 = (((h1 * 5) + 0xe6546b64)) & 0xffffffff;
    }
    let k2 = 0;
    switch (remainder) {
        case 3: k2 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
        case 2: k2 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
        case 1: k2 ^= (key.charCodeAt(i) & 0xff);
            k2 = (((k2 & 0xffff) * c1) + ((((k2 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
            k2 = (k2 << 15) | (k2 >>> 17);
            k2 = (((k2 & 0xffff) * c2) + ((((k2 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
            h1 ^= k2;
    }
    h1 ^= key.length; h1 ^= h1 >>> 16;
    h1 = (((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
    h1 ^= h1 >>> 13; h1 = (((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16)) & 0xffffffff;
    h1 ^= h1 >>> 16;
    return (h1 >>> 0).toString(16);
}

export function addSyncLog(msg: string, type: 'success' | 'error' | 'info' = 'info', icon?: string) {
    if (!state.syncLogs) state.syncLogs = [];
    state.syncLogs.push({ time: Date.now(), msg, type, icon });
    if (state.syncLogs.length > 50) state.syncLogs.shift();
    console.debug(`[Sync Log] ${msg}`);
}

export function setSyncStatus(statusKey: 'syncSaving' | 'syncSynced' | 'syncError' | 'syncInitial') {
    state.syncState = statusKey;
    if (ui.syncStatus) {
        ui.syncStatus.textContent = t(statusKey);
    }
}

export function setupNotificationListeners() {
    pushToOneSignal((OneSignal: any) => {
        OneSignal.Notifications.addEventListener('permissionChange', () => {
            setTimeout(updateNotificationUI, 500);
        });
        updateNotificationUI();
    });
}

async function resolveConflictWithServerState(serverShards: Record<string, string>) {
    const syncKey = getSyncKey();
    if (!syncKey) return setSyncStatus('syncError');
    
    try {
        addSyncLog("Conflito detectado. Mesclando dados...", "info", "🔄");
        const remoteShards: Record<string, any> = {};
        for (const key in serverShards) {
            if (key === 'lastModified') continue;
            try {
                const decrypted = await runWorkerTask<any>('decrypt', serverShards[key], syncKey);
                remoteShards[key] = decrypted;
            } catch (err) {
                console.warn(`[Sync] Failed to decrypt shard ${key}, skipping.`, err);
            }
        }

        const remoteState: any = {
            version: remoteShards['core']?.version || 0,
            lastModified: parseInt(serverShards.lastModified || '0', 10),
            habits: remoteShards['core']?.habits || [],
            dailyData: remoteShards['core']?.dailyData || {},
            archives: {},
            monthlyLogs: new Map(),
            notificationsShown: remoteShards['core']?.notificationsShown || [],
            hasOnboarded: remoteShards['core']?.hasOnboarded ?? true
        };

        for (const key in remoteShards) {
            if (key.startsWith('archive:')) { remoteState.archives[key.replace('archive:', '')] = remoteShards[key]; }
            if (key.startsWith('logs:')) { 
                remoteShards[key].forEach(([k, v]: [string, string]) => remoteState.monthlyLogs.set(k, BigInt(v))); 
            }
        }

        const localState = getPersistableState();
        const mergedState = await mergeStates(localState, remoteState);
        
        await persistStateLocally(mergedState);
        await loadState(mergedState);
        renderApp();
        
        setSyncStatus('syncSynced'); 
        addSyncLog("Mesclagem concluída.", "success", "✨");
        clearSyncHashCache(); 
        syncStateWithCloud(mergedState, true);
    } catch (error: any) {
        addSyncLog(`Erro na resolução: ${error.message}`, "error", "❌");
        setSyncStatus('syncError');
    }
}

async function performSync() {
    if (isSyncInProgress || !pendingSyncState) return;
    isSyncInProgress = true;
    const appState = pendingSyncState;
    pendingSyncState = null; 
    const syncKey = getSyncKey();
    if (!syncKey) { setSyncStatus('syncError'); isSyncInProgress = false; return; }

    try {
        const rawShards = splitIntoShards(appState);
        const encryptedShards: Record<string, string> = {};
        
        const pendingHashUpdates = new Map<string, string>();
        let changeCount = 0;

        for (const shardName in rawShards) {
            const currentHash = murmurHash3(JSON.stringify(rawShards[shardName]));
            const lastHash = lastSyncedHashes.get(shardName);
            
            if (currentHash !== lastHash) {
                const encrypted = await runWorkerTask<string>('encrypt', rawShards[shardName], syncKey);
                if (!encrypted || typeof encrypted !== 'string') {
                    throw new Error(`Encryption failed for shard ${shardName}: invalid result`);
                }
                encryptedShards[shardName] = encrypted;
                pendingHashUpdates.set(shardName, currentHash);
                changeCount++;
            }
        }

        if (changeCount === 0) {
            setSyncStatus('syncSynced');
            isSyncInProgress = false;
            return;
        }

        addSyncLog(`Sincronizando ${changeCount} pacotes...`, "info", "📤");
        const safeTs = appState.lastModified || Date.now();
        
        const payload = { lastModified: safeTs, shards: encryptedShards };
        
        // Validate payload before sending
        let payloadStr: string;
        try {
            payloadStr = JSON.stringify(payload);
        } catch (jsonErr: any) {
            throw new Error(`Failed to serialize payload: ${jsonErr.message}`);
        }
        
        if (payloadStr.length > 10 * 1024 * 1024) {
            throw new Error(`Payload too large: ${(payloadStr.length / 1024 / 1024).toFixed(2)}MB`);
        }
        
        const response = await apiFetch('/api/sync', { 
            method: 'POST', 
            body: payloadStr
        }, true);

        if (response.status === 409) {
            clearSyncHashCache();
            await resolveConflictWithServerState(await response.json());
            recordSyncAttempt(payloadStr.length, true);
        } else if (response.ok) {
            addSyncLog("Nuvem atualizada.", "success", "✅");
            setSyncStatus('syncSynced');
            pendingHashUpdates.forEach((hash, shard) => lastSyncedHashes.set(shard, hash));
            persistHashCache();
            recordSyncAttempt(payloadStr.length, true);
            document.dispatchEvent(new CustomEvent('habitsChanged')); 
        } else {
            let errorData: any = {};
            try {
                errorData = await response.json();
            } catch (e) {
                console.error("Failed to parse error response:", e);
                errorData = { error: `HTTP ${response.status}` };
            }
            const errorMsg = errorData.error || `Erro ${response.status}`;
            throw new Error(errorMsg);
        }
    } catch (error: any) {
        const errorMsg = error.message || String(error);
        recordSyncAttempt(0, false, errorMsg);
        
        // ===== DETERMINE IF ERROR IS RETRYABLE =====
        // Erros que NÃO devem fazer retry (permanentes):
        const isJsonError = errorMsg.includes('JSON_PARSE_ERROR') || 
                           errorMsg.includes('Failed to serialize') ||
                           errorMsg.includes('Encryption failed') ||
                           errorMsg.includes('too large');
        
        const isValidationError = errorMsg.includes('INVALID_SHARDS_TYPE') ||
                                 errorMsg.includes('TOO_MANY_SHARDS') ||
                                 errorMsg.includes('SHARD_NOT_STRING');
        
        // Erros que SÃO retryable (temporários):
        const isNetworkError = errorMsg.includes('Network') ||
                              errorMsg.includes('timeout') ||
                              errorMsg.includes('ERR_');
        
        const isServerError = errorMsg.includes('500') ||
                             errorMsg.includes('502') ||
                             errorMsg.includes('503') ||
                             errorMsg.includes('429') ||
                             errorMsg.includes('Lua Execution Error'); // Lua errors podem ser temporários em alguns casos
        
        const isRetryable = isNetworkError || (isServerError && !isJsonError && !isValidationError);
        
        // ===== RETRY LOGIC (apenas para erros temporários) =====
        if (isRetryable && syncRetryAttempt < RETRY_CONFIG.maxAttempts) {
            // Incrementar ANTES de calcular o delay
            syncRetryAttempt++;
            const nextDelay = calculateRetryDelay(syncRetryAttempt - 1);
            
            addSyncLog(
                `Falha no envio: ${errorMsg}. Tentativa ${syncRetryAttempt}/${RETRY_CONFIG.maxAttempts} em ${(nextDelay/1000).toFixed(1)}s...`,
                "error",
                "🔄"
            );
            
            console.warn("[Sync] Retry scheduled (retryable error):", {
                attempt: syncRetryAttempt,
                delayMs: nextDelay,
                error: errorMsg,
                isRetryable
            });
            
            isSyncInProgress = false;
            syncTimeout = window.setTimeout(() => {
                syncTimeout = null;
                pendingSyncState = appState; // Re-enqueue para retry
                performSync();
            }, nextDelay);
            
            return; // Não marcar como erro fatal ainda
        }
        
        // ===== FINAL ERROR (não-retryable ou max tentativas) =====
        const finalMsg = !isRetryable ? 
            `Erro não-recuperável: ${errorMsg}` :
            `Falha após ${RETRY_CONFIG.maxAttempts} tentativas: ${errorMsg}`;
        
        addSyncLog(finalMsg, "error", "⚠️");
        
        console.error("[Sync] Final error:", { 
            message: errorMsg, 
            stack: error.stack,
            timestamp: new Date().toISOString(),
            retries: syncRetryAttempt,
            isRetryable,
            isJsonError,
            isValidationError
        });
        
        syncRetryAttempt = 0; // Reset para próxima tentativa de sync normal
        setSyncStatus('syncError');
    } finally {
        isSyncInProgress = false;
        // NÃO agendar nova sincronização aqui - deixar que o sistema normal a agende
    }
}

export function syncStateWithCloud(appState: AppState, immediate = false) {
    if (!hasLocalSyncKey()) return;
    pendingSyncState = appState; 
    setSyncStatus('syncSaving');
    if (syncTimeout) clearTimeout(syncTimeout);
    if (isSyncInProgress) return;
    if (immediate) performSync();
    else syncTimeout = window.setTimeout(performSync, DEBOUNCE_DELAY);
}

async function reconstructStateFromShards(shards: Record<string, string>): Promise<AppState | undefined> {
    const syncKey = getSyncKey();
    if (!syncKey) return undefined;
    try {
        const decryptedShards: Record<string, any> = {};
        for (const key in shards) {
            if (key === 'lastModified') continue;
            try {
                decryptedShards[key] = await runWorkerTask<any>('decrypt', shards[key], syncKey);
                lastSyncedHashes.set(key, murmurHash3(JSON.stringify(decryptedShards[key])));
            } catch (e) {
                console.warn(`[Sync] Skip decrypt ${key}`, e);
            }
        }
        
        persistHashCache();

        const result: any = {
            version: decryptedShards['core']?.version || 0,
            lastModified: parseInt(shards.lastModified || '0', 10),
            habits: decryptedShards['core']?.habits || [],
            dailyData: decryptedShards['core']?.dailyData || {},
            archives: {},
            monthlyLogs: new Map(),
            notificationsShown: decryptedShards['core']?.notificationsShown || [],
            hasOnboarded: decryptedShards['core']?.hasOnboarded ?? true,
            quoteState: decryptedShards['core']?.quoteState
        };
        for (const key in decryptedShards) {
            if (key.startsWith('archive:')) { result.archives[key.replace('archive:', '')] = decryptedShards[key]; }
            if (key.startsWith('logs:')) { 
                decryptedShards[key].forEach(([k, v]: [string, string]) => result.monthlyLogs.set(k, BigInt(v))); 
            }
        }
        return result;
    } catch (e) {
        console.error("State reconstruction failed:", e);
        return undefined;
    }
}

export async function downloadRemoteState(): Promise<AppState | undefined> {
    addSyncLog("Baixando dados remotos...", "info", "🔍");
    const response = await apiFetch('/api/sync', {}, true);
    if (response.status === 304) { addSyncLog("Sem novidades na nuvem.", "info", "💤"); return undefined; }
    if (!response.ok) throw new Error("Falha na conexão com a nuvem");
    const shards = await response.json();
    if (!shards || Object.keys(shards).length === 0) { addSyncLog("Cofre vazio na nuvem.", "info", "🌫️"); return undefined; }
    addSyncLog("Dados baixados com sucesso.", "success", "📥");
    return await reconstructStateFromShards(shards);
}

export async function fetchStateFromCloud(): Promise<AppState | undefined> {
    if (!hasLocalSyncKey()) {
        state.initialSyncDone = true;
        return undefined;
    }
    setSyncStatus('syncSaving'); 
    try {
        const response = await apiFetch('/api/sync', {}, true);
        if (response.status === 304) { 
            state.initialSyncDone = true;
            setSyncStatus('syncSynced'); 
            return undefined; 
        }
        if (!response.ok) throw new Error("Cloud fetch failed with status " + response.status);
        const shards = await response.json();
        if (!shards || Object.keys(shards).length === 0) {
            state.initialSyncDone = true;
            return undefined;
        }
        const remoteState = await reconstructStateFromShards(shards);
        if (!remoteState) {
            state.initialSyncDone = true;
            return undefined;
        }
        const localState = getPersistableState();
        const remoteModified = remoteState.lastModified || 0, localModified = localState.lastModified || 0;
        
        if (remoteModified > localModified) {
            addSyncLog("Atualização remota detectada.", "info", "☁️");
            const mergedState = await mergeStates(localState, remoteState);
            await persistStateLocally(mergedState);
            await loadState(mergedState);
            renderApp();
        } else if (localModified > remoteModified) {
            addSyncLog("Sincronizando mudanças locais...", "info", "🚀");
            syncStateWithCloud(localState, true);
        } else {
            setSyncStatus('syncSynced');
        }
        return remoteState;
    } catch (error) {
        console.warn("[Cloud] Boot sync failed (Offline or Error). Proceeding locally.", error);
        setSyncStatus('syncError');
        return undefined;
    } finally {
        state.initialSyncDone = true;
    }
}

// ===== TELEMETRY & MONITORING EXPORTS =====

/**
 * Retorna o status de saúde da sincronização
 * @returns {object} Objeto com métricas de sincronização
 */
export function getSyncStatus() {
    return getSyncHealthStatus();
}

/**
 * Retorna telemetria completa de sincronização
 * @returns {SyncTelemetry} Dados detalhados de sincronização
 */
export function getSyncTelemetry(): SyncTelemetry {
    return { ...syncTelemetry };
}

/**
 * Retorna número de tentativas de retry em andamento
 * @returns {number} Tentativa atual (0 se sucesso)
 */
export function getSyncRetryCount(): number {
    return syncRetryAttempt;
}

/**
 * Reseta telemetria e contadores de retry
 */
export function resetSyncTelemetry() {
    syncTelemetry = {
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        totalPayloadBytes: 0,
        maxPayloadBytes: 0,
        avgPayloadBytes: 0,
        errorFrequency: {},
        lastError: null
    };
    syncRetryAttempt = 0;
    saveTelemetry();
    console.info("[Telemetry] Resetado com sucesso");
}