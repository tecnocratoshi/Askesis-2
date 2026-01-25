/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file cloud.ts
 * @description Orquestrador de Sincronização Granular (Shard-based Diffing).
 */

import { AppState, state, getPersistableState, APP_VERSION } from '../state';
import { loadState, persistStateLocally } from './persistence';
import { generateUUID } from '../utils';
import { ui } from '../render/ui';
import { t } from '../i18n';
import { hasLocalSyncKey, getSyncKey, apiFetch } from './api';
import { renderApp } from '../render';
import { mergeStates } from './dataMerge';
import { HabitService } from './HabitService';

let syncTimeout: number | null = null;
const DEBOUNCE_DELAY = 2000; 

let isSyncInProgress = false;
let pendingSyncState: AppState | null = null;

const lastSyncedHashes = new Map<string, string>();

let syncWorker: Worker | null = null;
const workerCallbacks = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>();

function getWorker(): Worker {
    if (!syncWorker) {
        syncWorker = new Worker('./sync-worker.js', { type: 'module' });
        syncWorker.onmessage = (e) => {
            const { id, status, result, error } = e.data;
            const callback = workerCallbacks.get(id);
            if (callback && status === 'success') { callback.resolve(result); workerCallbacks.delete(id); }
            else if (callback) { callback.reject(new Error(error)); workerCallbacks.delete(id); }
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
    
    // 1. Shard Core: Dados dinâmicos
    shards['core'] = {
        habits: appState.habits,
        dailyData: appState.dailyData,
        dailyDiagnoses: appState.dailyDiagnoses,
        notificationsShown: appState.notificationsShown,
        hasOnboarded: appState.hasOnboarded,
        quoteState: appState.quoteState
    };

    // 2. Shards de Logs: Um por Mês (logs:2024-05)
    const groupedLogs = HabitService.getLogsGroupedByMonth();
    for (const month in groupedLogs) {
        shards[`logs:${month}`] = groupedLogs[month];
    }

    // 3. Shards Archives: Um por Ano
    for (const year in appState.archives) {
        shards[`archive:${year}`] = appState.archives[year];
    }

    return shards;
}

/**
 * Limpa o cache local de hashes de sincronização.
 * Usado ao trocar de chave criptográfica para forçar um re-upload completo.
 */
export function clearSyncHashCache() {
    lastSyncedHashes.clear();
    console.debug("[Sync] Hash cache cleared.");
}

/**
 * MurmurHash3 32-bit (Seedable).
 */
function murmurHash3(key: string, seed: number = APP_VERSION): string {
    let remainder = key.length & 3;
    let bytes = key.length - remainder;
    let h1 = seed;
    let c1 = 0xcc9e2d51;
    let c2 = 0x1b873593;
    let i = 0;

    while (i < bytes) {
        let k1 = ((key.charCodeAt(i) & 0xff)) |
            ((key.charCodeAt(++i) & 0xff) << 8) |
            ((key.charCodeAt(++i) & 0xff) << 16) |
            ((key.charCodeAt(++i) & 0xff) << 24);
        ++i;

        k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;

        h1 ^= k1;
        h1 = (h1 << 13) | (h1 >>> 19);
        h1 = (((h1 * 5) + 0xe6546b64)) & 0xffffffff;
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

    h1 ^= key.length;
    h1 ^= h1 >>> 16;
    h1 = (((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
    h1 ^= h1 >>> 13;
    h1 = (((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16)) & 0xffffffff;
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
    if (ui.syncStatus) ui.syncStatus.textContent = t(statusKey);
}

async function resolveConflictWithServerState(serverShards: Record<string, string>) {
    const syncKey = getSyncKey();
    if (!syncKey) return setSyncStatus('syncError');
    
    try {
        addSyncLog("Conflito detectado. Iniciando Smart Merge...", "info", "🔄");
        const remoteShards: Record<string, any> = {};
        for (const key in serverShards) {
            if (key === 'lastModified') continue;
            remoteShards[key] = await runWorkerTask<any>('decrypt', serverShards[key], syncKey);
        }

        const remoteState: any = {
            lastModified: parseInt(serverShards.lastModified || '0', 10),
            habits: remoteShards['core']?.habits || [],
            dailyData: remoteShards['core']?.dailyData || {},
            archives: {},
            monthlyLogs: new Map(),
            notificationsShown: remoteShards['core']?.notificationsShown || [],
            hasOnboarded: remoteShards['core']?.hasOnboarded ?? true
        };

        for (const key in remoteShards) {
            if (key.startsWith('archive_')) {
                remoteState.archives[key.replace('archive_', '')] = remoteShards[key];
            }
            if (key.startsWith('logs:')) {
                remoteShards[key].forEach(([k, v]: [string, string]) => remoteState.monthlyLogs.set(k, BigInt(v)));
            }
        }

        const localState = getPersistableState();
        const mergedState = await mergeStates(localState, remoteState);
        
        await persistStateLocally(mergedState, true);
        await loadState(mergedState);
        renderApp();
        
        setSyncStatus('syncSynced'); 
        addSyncLog("Dados mesclados com sucesso.", "success", "✨");
        lastSyncedHashes.clear();
        syncStateWithCloud(mergedState, true);
    } catch (error) {
        addSyncLog("Falha na resolução de conflito.", "error", "❌");
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
        const dirtyShards: Record<string, string> = {};
        let changeCount = 0;

        for (const shardName in rawShards) {
            const currentHash = murmurHash3(JSON.stringify(rawShards[shardName]));
            const lastHash = lastSyncedHashes.get(shardName);

            if (currentHash !== lastHash) {
                dirtyShards[shardName] = await runWorkerTask<string>('encrypt', rawShards[shardName], syncKey);
                lastSyncedHashes.set(shardName, currentHash);
                changeCount++;
            }
        }

        if (changeCount === 0) {
            addSyncLog("Nenhuma alteração pendente para upload.", "info", "💨");
            setSyncStatus('syncSynced');
            isSyncInProgress = false;
            return;
        }

        addSyncLog(`Enviando ${changeCount} shards para nuvem...`, "info", "📤");
        const payload = { lastModified: appState.lastModified, shards: dirtyShards };
        const response = await apiFetch('/api/sync', { method: 'POST', body: JSON.stringify(payload) }, true);

        if (response.status === 409) {
            lastSyncedHashes.clear();
            await resolveConflictWithServerState(await response.json());
        } else if (response.ok || response.status === 304) {
            addSyncLog("Sincronização concluída.", "success", "✅");
            setSyncStatus('syncSynced');
            document.dispatchEvent(new CustomEvent('habitsChanged')); 
        } else {
            throw new Error(`Sync error: ${response.status}`);
        }
    } catch (error: any) {
        addSyncLog(`Erro: ${error.message}`, "error", "⚠️");
        setSyncStatus('syncError');
    } finally {
        isSyncInProgress = false;
        if (pendingSyncState) setTimeout(performSync, 500);
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
            decryptedShards[key] = await runWorkerTask<any>('decrypt', shards[key], syncKey);
            lastSyncedHashes.set(key, murmurHash3(JSON.stringify(decryptedShards[key])));
        }

        const result: any = {
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
            if (key.startsWith('archive:')) {
                result.archives[key.replace('archive:', '')] = decryptedShards[key];
            }
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
    addSyncLog("Buscando dados na nuvem...", "info", "🔍");
    const response = await apiFetch('/api/sync', {}, true);
    if (response.status === 304) {
        addSyncLog("Nuvens em repouso (304).", "info", "💤");
        return undefined;
    }
    if (!response.ok) throw new Error("Cloud fetch failed");
    const shards = await response.json();
    if (!shards) {
        addSyncLog("Nenhum dado encontrado na nuvem.", "info", "🌫️");
        return undefined;
    }
    addSyncLog("Dados remotos baixados com sucesso.", "success", "📥");
    return await reconstructStateFromShards(shards);
}

export async function fetchStateFromCloud(): Promise<AppState | undefined> {
    if (!hasLocalSyncKey()) return undefined;
    try {
        const response = await apiFetch('/api/sync', {}, true);
        if (response.status === 304) { setSyncStatus('syncSynced'); return undefined; }
        if (!response.ok) throw new Error("Cloud fetch failed");
        
        const shards = await response.json();
        if (!shards) return undefined;

        const remoteState = await reconstructStateFromShards(shards);
        if (!remoteState) return undefined;

        const localState = getPersistableState();
        const remoteModified = remoteState.lastModified || 0;
        const localModified = localState.lastModified || 0;

        if (remoteModified > localModified) {
            addSyncLog("Sincronizando atualização remota...", "info", "☁️");
            const mergedState = await mergeStates(localState, remoteState);
            await persistStateLocally(mergedState, true);
            await loadState(mergedState);
            renderApp();
        } else if (localModified > remoteModified) {
            addSyncLog("Local é mais recente. Forçando upload.", "info", "🚀");
            syncStateWithCloud(localState, true);
        }

        setSyncStatus('syncSynced');
        return remoteState;
    } catch (error) {
        setSyncStatus('syncError');
        throw error;
    }
}
