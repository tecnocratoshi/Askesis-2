
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
        // REPAIR: Caminho relativo explícito e tratamento de erro de carga
        syncWorker = new Worker('./sync-worker.js', { type: 'module' });
        
        syncWorker.onmessage = (e) => {
            const { id, status, result, error } = e.data;
            const callback = workerCallbacks.get(id);
            if (callback) {
                if (status === 'success') {
                    callback.resolve(result);
                } else {
                    callback.reject(new Error(error || "Worker Task Failed"));
                }
                workerCallbacks.delete(id);
            }
        };
        
        syncWorker.onerror = (e) => {
            console.error("CRITICAL: Sync Worker Error", e);
            // Se o worker morrer, rejeitamos todas as promessas pendentes para destravar a UI
            workerCallbacks.forEach((cb, id) => {
                cb.reject(new Error("Worker failed to initialize"));
                workerCallbacks.delete(id);
            });
            syncWorker = null; // Permite tentativa de recriação na próxima tarefa
        };
    }
    return syncWorker;
}

/**
 * Adiciona um log de sincronização ou atividade da IA ao estado global.
 */
export function addSyncLog(msg: string, type: 'success' | 'error' | 'info', icon?: string) {
    if (!state.syncLogs) state.syncLogs = [];
    state.syncLogs.unshift({
        time: Date.now(),
        msg,
        type,
        icon
    });
    if (state.syncLogs.length > 50) {
        state.syncLogs.length = 50;
    }
}

/**
 * Executa uma tarefa no Web Worker com timeout de segurança.
 */
export function runWorkerTask<T>(type: 'encrypt' | 'decrypt' | 'build-ai-prompt' | 'build-quote-analysis-prompt' | 'prune-habit' | 'archive', payload: any, key?: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const id = generateUUID();
        const timeoutMs = 15000; // 15 segundos para operações pesadas de criptografia
        
        const timeoutId = setTimeout(() => {
            if (workerCallbacks.has(id)) {
                console.warn(`Worker task ${type} timed out after ${timeoutMs}ms`);
                workerCallbacks.delete(id);
                reject(new Error("Timeout de processamento (Worker)"));
            }
        }, timeoutMs);

        workerCallbacks.set(id, { 
            resolve: (val) => { clearTimeout(timeoutId); resolve(val); }, 
            reject: (err) => { clearTimeout(timeoutId); reject(err); } 
        });
        
        try {
            getWorker().postMessage({ id, type, payload, key });
        } catch (e) {
            clearTimeout(timeoutId);
            workerCallbacks.delete(id);
            reject(e);
        }
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
        setSyncStatus('syncError');
        return;
    }
    
    try {
        const serverState = await runWorkerTask<AppState>('decrypt', serverPayload.state, syncKey);
        const localState = getPersistableState();
        const mergedState = await mergeStates(localState, serverState);

        await persistStateLocally(mergedState, true); 
        await loadState(mergedState);
        
        state.uiDirtyState.habitListStructure = true;
        state.uiDirtyState.calendarVisuals = true;
        state.uiDirtyState.chartData = true;

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
        } else if (!response.ok) {
            // REPAIR: Trata erros 401, 500, etc. que antes eram marcados como "Synced"
            throw new Error(`Server error: ${response.status}`);
        } else {
            setSyncStatus('syncSynced');
            document.dispatchEvent(new CustomEvent('habitsChanged')); 
        }
    } catch (error) {
        console.error("Sync failure:", error);
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
    
    if (isSyncInProgress) return;

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
        
        if (!response.ok) {
            if (response.status === 401) throw new Error("Não autorizado: Chave inválida");
            throw new Error(`Erro na nuvem: ${response.status}`);
        }

        const data: ServerPayload | null = await response.json();

        if (data && data.state) {
            const appState = await runWorkerTask<AppState>('decrypt', data.state, syncKey);
            setSyncStatus('syncSynced');
            return appState;
        } else {
            if (state.habits.length > 0) {
                syncStateWithCloud(getPersistableState(), true);
            }
            setSyncStatus('syncSynced');
            return undefined;
        }
    } catch (error) {
        console.error("Failed to fetch state:", error);
        setSyncStatus('syncError');
        throw error;
    }
}

export { fetchStateFromCloud as downloadRemoteState };
