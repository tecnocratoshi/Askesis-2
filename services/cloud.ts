
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
            // REPAIR: Rejeita todas as callbacks pendentes em caso de erro fatal no worker
            workerCallbacks.forEach((cb) => cb.reject(new Error("Worker error")));
            workerCallbacks.clear();
        };
    }
    return syncWorker;
}

// --- FIX: Export addSyncLog function to fix missing member error in habitActions.ts ---
/**
 * Adiciona um log de sincronização ou atividade da IA ao estado global.
 */
export function addSyncLog(msg: string, type: 'success' | 'error' | 'info', icon?: string) {
    if (!state.syncLogs) (state as any).syncLogs = [];
    state.syncLogs.unshift({
        time: Date.now(),
        msg,
        type,
        icon
    });
    // Limita o histórico de logs para evitar estouro de memória/estado
    if (state.syncLogs.length > 50) {
        state.syncLogs.length = 50;
    }
}

export function runWorkerTask<T>(type: 'encrypt' | 'decrypt' | 'build-ai-prompt' | 'build-quote-analysis-prompt' | 'prune-habit' | 'archive', payload: any, key?: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const id = generateUUID();
        workerCallbacks.set(id, { resolve, reject });
        getWorker().postMessage({ id, type, payload, key });
        
        // SAFETY TIMEOUT: Se o worker não responder em 30s, cancela para não travar a UI
        setTimeout(() => {
            if (workerCallbacks.has(id)) {
                workerCallbacks.get(id)?.reject(new Error("Worker timeout"));
                workerCallbacks.delete(id);
            }
        }, 30000);
    });
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

export function setupNotificationListeners() {
    pushToOneSignal((OneSignal: any) => {
        OneSignal.Notifications.addEventListener('permissionChange', () => {
            setTimeout(updateNotificationUI, 500);
        });
        updateNotificationUI();
    });
}

async function resolveConflictWithServerState(serverPayload: ServerPayload) {
    console.warn("Sync conflict detected. Initiating Smart Merge sequence.");
    
    const syncKey = getSyncKey();
    if (!syncKey) {
        console.error("Cannot resolve conflict without sync key.");
        setSyncStatus('syncError');
        return;
    }
    
    try {
        const serverState = await runWorkerTask<AppState>('decrypt', serverPayload.state, syncKey);
        const localState = getPersistableState();
        const mergedState = await mergeStates(localState, serverState);
        console.log("Smart Merge completed successfully.");

        // REPAIR [2025-06-05]: Passa 'true' para suprimir sincronização imediata do persistStateLocally.
        // Já faremos a sincronização manual abaixo após atualizar a memória.
        await persistStateLocally(mergedState, true); 
        await loadState(mergedState);
        
        state.uiDirtyState.habitListStructure = true;
        state.uiDirtyState.calendarVisuals = true;
        state.uiDirtyState.chartData = true;

        renderApp();
        setSyncStatus('syncSynced'); 
        document.dispatchEvent(new CustomEvent('habitsChanged'));

        // Empurra o estado mesclado final de volta para a nuvem para estabilizar
        syncStateWithCloud(mergedState, true);
        
    } catch (error) {
        console.error("Failed to resolve conflict with server state:", error);
        setSyncStatus('syncError');
    }
}

async function performSync() {
    if (isSyncInProgress || !pendingSyncState) {
        return;
    }

    isSyncInProgress = true;
    const appState = pendingSyncState;
    pendingSyncState = null; 

    const syncKey = getSyncKey();
    if (!syncKey) {
        setSyncStatus('syncError');
        console.error("Cannot sync without a sync key.");
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
        } else if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        } else {
            setSyncStatus('syncSynced');
            document.dispatchEvent(new CustomEvent('habitsChanged')); 
        }
    } catch (error) {
        console.error("Error syncing state to cloud:", error);
        setSyncStatus('syncError');
    } finally {
        isSyncInProgress = false;
        
        if (pendingSyncState) {
            if (syncTimeout) clearTimeout(syncTimeout);
            performSync();
        }
    }
}

export function syncStateWithCloud(appState: AppState, immediate = false) {
    if (!hasLocalSyncKey()) return;

    pendingSyncState = appState; 
    setSyncStatus('syncSaving');

    if (syncTimeout) clearTimeout(syncTimeout);
    
    if (isSyncInProgress) {
        return;
    }

    if (immediate) {
        performSync();
    } else {
        syncTimeout = window.setTimeout(performSync, DEBOUNCE_DELAY);
    }
}

export async function fetchStateFromCloud(): Promise<AppState | undefined> {
    if (!hasLocalSyncKey()) return undefined;

    const syncKey = getSyncKey();
    if (!syncKey) return undefined;

    try {
        const response = await apiFetch('/api/sync', {}, true);
        const data: ServerPayload | null = await response.json();

        if (data && data.state) {
            const appState = await runWorkerTask<AppState>('decrypt', data.state, syncKey);
            setSyncStatus('syncSynced');
            return appState;
        } else {
            console.log("No state found in cloud for this sync key. Performing initial sync.");
            
            if (state.habits.length > 0 || Object.keys(state.dailyData).length > 0) {
                syncStateWithCloud(getPersistableState(), true);
            }
            return undefined;
        }
    } catch (error) {
        console.error("Failed to fetch state from cloud:", error);
        setSyncStatus('syncError');
        throw error;
    }
}

export { fetchStateFromCloud as downloadRemoteState };
