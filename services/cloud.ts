
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
import { generateUUID } from '../utils';
import { ui } from '../render/ui';
import { t } from '../i18n';
import { hasLocalSyncKey, getSyncKey, apiFetch } from './api';
import { renderApp, showToast } from '../render';
import { mergeStates } from './dataMerge';

let syncTimeout: number | null = null;
const DEBOUNCE_DELAY = 2000; 

let isSyncInProgress = false;
let pendingSyncState: AppState | null = null;

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

export function addSyncLog(msg: string, type: 'success' | 'error' | 'info' = 'info', icon?: string) {
    if (!state.syncLogs) state.syncLogs = [];
    state.syncLogs.push({ time: Date.now(), msg, type, icon });
    if (state.syncLogs.length > 50) state.syncLogs.shift();
    
    // Integração com showToast para feedback imediato na UI
    if (type === 'success' || type === 'error' || icon === '🔄' || icon === '☁️') {
        showToast(msg, type, icon);
    }
}

interface ServerPayload { lastModified: number; state: string; }

export function setSyncStatus(statusKey: 'syncSaving' | 'syncSynced' | 'syncError' | 'syncInitial') {
    state.syncState = statusKey;
    if (ui.syncStatus) ui.syncStatus.textContent = t(statusKey);
}

async function resolveConflictWithServerState(serverPayload: ServerPayload) {
    const syncKey = getSyncKey();
    if (!syncKey) return setSyncStatus('syncError');
    
    try {
        const serverState = await runWorkerTask<AppState>('decrypt', serverPayload.state, syncKey);
        const localState = getPersistableState();
        addSyncLog("Conflito detectado. Iniciando Smart Merge...", "info", "🔄");
        const mergedState = await mergeStates(localState, serverState);
        
        // Uso de persistência imediata para garantir integridade do merge
        await persistStateLocally(mergedState, true);
        await loadState(mergedState);
        renderApp();
        
        setSyncStatus('syncSynced'); 
        addSyncLog("Dados mesclados com sucesso.", "success", "✨");
        document.dispatchEvent(new CustomEvent('habitsChanged'));
        syncStateWithCloud(mergedState, true);
    } catch (error) {
        addSyncLog("Falha ao resolver conflito.", "error", "❌");
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
        const encryptedState = await runWorkerTask<string>('encrypt', appState, syncKey);
        const payload: ServerPayload = { lastModified: appState.lastModified, state: encryptedState };
        const response = await apiFetch('/api/sync', { method: 'POST', body: JSON.stringify(payload) }, true);

        if (response.status === 409) {
            await resolveConflictWithServerState(await response.json());
        } else if (response.ok || response.status === 304) {
            setSyncStatus('syncSynced');
            document.dispatchEvent(new CustomEvent('habitsChanged')); 
        } else {
            throw new Error(`Sync error: ${response.status}`);
        }
    } catch (error) {
        console.error("Sync failed:", error);
        setSyncStatus('syncError');
        
        // Registro de Background Sync nativo para tentativas posteriores
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            navigator.serviceWorker.ready.then((reg: any) => {
                return (reg as any).sync.register('sync-cloud-pending');
            }).catch(e => console.warn("Failed to register Background Sync", e));
        }
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

/**
 * @fix: Added downloadRemoteState for pure remote state retrieval without boot side-effects.
 */
export async function downloadRemoteState(): Promise<AppState | undefined> {
    const syncKey = getSyncKey();
    if (!syncKey) return undefined;

    const response = await apiFetch('/api/sync', {}, true);
    if (response.status === 304) return undefined;
    if (!response.ok) throw new Error("Cloud fetch failed");
    
    let data = await response.json();
    if (typeof data === 'string') data = JSON.parse(data);
    
    if (data && data.state) {
        return await runWorkerTask<AppState>('decrypt', data.state, syncKey);
    }
    return undefined;
}

export async function fetchStateFromCloud(): Promise<AppState | undefined> {
    if (!hasLocalSyncKey()) return undefined;
    const syncKey = getSyncKey();
    if (!syncKey) return undefined;

    try {
        const response = await apiFetch('/api/sync', {}, true);
        if (response.status === 304) { setSyncStatus('syncSynced'); return undefined; }
        if (!response.ok) throw new Error("Cloud fetch failed");
        let data = await response.json();
        if (typeof data === 'string') data = JSON.parse(data);
        const localState = getPersistableState();
        if (data && data.state) {
            const remoteModified = data.lastModified || 0, localModified = localState.lastModified || 0;
            if (localModified > remoteModified) { syncStateWithCloud(localState, true); return undefined; }
            const remoteState = await runWorkerTask<AppState>('decrypt', data.state, syncKey);
            if (remoteModified > localModified) {
                addSyncLog("Sincronizando com nuvem...", "info", "☁️");
                const mergedState = await mergeStates(localState, remoteState);
                await persistStateLocally(mergedState, true);
                await loadState(mergedState);
                renderApp();
            }
            setSyncStatus('syncSynced');
            return remoteState;
        } else {
            if (localState.habits.length > 0) syncStateWithCloud(localState, true);
            setSyncStatus('syncSynced');
            return undefined;
        }
    } catch (error) {
        setSyncStatus('syncError');
        throw error;
    }
}
