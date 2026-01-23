
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

// PERFORMANCE: Debounce para evitar salvar na nuvem a cada pequena alteração
let syncTimeout: number | null = null;
const DEBOUNCE_DELAY = 2000; 

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

// @fix: Added missing addSyncLog function export to resolve import error in habitActions.ts
export function addSyncLog(msg: string, type: 'success' | 'error' | 'info' = 'info', icon?: string) {
    if (!state.syncLogs) state.syncLogs = [];
    state.syncLogs.push({
        time: Date.now(),
        msg,
        type,
        icon
    });
    // Keep logs reasonable size
    if (state.syncLogs.length > 50) {
        state.syncLogs.shift();
    }
}

interface ServerPayload {
    lastModified: number;
    state: string;
}

export function setSyncStatus(statusKey: 'syncSaving' | 'syncSynced' | 'syncError' | 'syncInitial') {
    state.syncState = statusKey;
    if (ui.syncStatus) {
        ui.syncStatus.textContent = t(statusKey);
    }
}

async function resolveConflictWithServerState(serverPayload: ServerPayload) {
    const syncKey = getSyncKey();
    if (!syncKey) {
        setSyncStatus('syncError');
        return;
    }
    
    try {
        const serverState = await runWorkerTask<AppState>('decrypt', serverPayload.state, syncKey);
        const localState = getPersistableState();
        const mergedState = await mergeStates(localState, serverState);

        await persistStateLocally(mergedState);
        await loadState(mergedState);
        
        renderApp();
        setSyncStatus('syncSynced'); 
        document.dispatchEvent(new CustomEvent('habitsChanged'));

        syncStateWithCloud(mergedState, true);
    } catch (error) {
        console.error("Failed to resolve conflict:", error);
        setSyncStatus('syncError');
    }
}

async function performSync() {
    if (isSyncInProgress || !pendingSyncState) return;

    isSyncInProgress = true;
    const appState = pendingSyncState;
    pendingSyncState = null; 

    const syncKey = getSyncKey();
    if (!syncKey) {
        setSyncStatus('syncError');
        isSyncInProgress = false; 
        return;
    }

    try {
        const encryptedState = await runWorkerTask<string>('encrypt', appState, syncKey);
        const payload: ServerPayload = {
            lastModified: appState.lastModified,
            state: encryptedState,
        };
        
        const response = await apiFetch('/api/sync', {
            method: 'POST',
            body: JSON.stringify(payload),
        }, true);

        if (response.status === 409) {
            const serverPayload: ServerPayload = await response.json();
            await resolveConflictWithServerState(serverPayload);
        } else if (response.ok || response.status === 304) {
            setSyncStatus('syncSynced');
            document.dispatchEvent(new CustomEvent('habitsChanged')); 
        } else {
            throw new Error(`Sync failed: ${response.status}`);
        }
    } catch (error) {
        console.error("Sync error:", error);
        setSyncStatus('syncError');
    } finally {
        isSyncInProgress = false;
        if (pendingSyncState) performSync();
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

export async function fetchStateFromCloud(): Promise<AppState | undefined> {
    if (!hasLocalSyncKey()) return undefined;
    const syncKey = getSyncKey();
    if (!syncKey) return undefined;

    try {
        const response = await apiFetch('/api/sync', {}, true);
        if (!response.ok) throw new Error("Fetch failed");

        let data = await response.json();
        // REPAIR: Trata casos onde o servidor envia string JSON em vez de objeto
        if (typeof data === 'string') data = JSON.parse(data);

        if (data && data.state) {
            const appState = await runWorkerTask<AppState>('decrypt', data.state, syncKey);
            setSyncStatus('syncSynced');
            return appState;
        } else {
            if (state.habits.length > 0) syncStateWithCloud(getPersistableState(), true);
            setSyncStatus('syncSynced');
            return undefined;
        }
    } catch (error) {
        console.error("Cloud fetch error:", error);
        setSyncStatus('syncError');
        throw error;
    }
}

export { fetchStateFromCloud as downloadRemoteState };
