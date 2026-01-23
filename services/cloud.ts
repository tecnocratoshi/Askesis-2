
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

// --- TELEMETRY ---
/**
 * Adiciona um log estruturado ao sistema de telemetria.
 * @param msg Mensagem descritiva.
 * @param type Severidade visual.
 * @param icon Ícone representativo da operação.
 */
function addSyncLog(msg: string, type: 'success' | 'error' | 'info' = 'info', icon?: string) {
    state.syncLogs.push({ time: Date.now(), msg, type, icon });
    if (state.syncLogs.length > 50) state.syncLogs.shift();
    document.dispatchEvent(new CustomEvent('sync-logs-updated'));
}

function getPayloadSizeString(payload: any): string {
    const size = new TextEncoder().encode(JSON.stringify(payload)).length;
    if (size < 1024) return `${size}B`;
    return `${(size / 1024).toFixed(1)}KB`;
}

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
                if (status === 'success') callback.resolve(result);
                else callback.reject(new Error(error));
                workerCallbacks.delete(id);
            }
        };
    }
    return syncWorker;
}

// @fix: Expanded type union to include 'build-quote-analysis-prompt', 'prune-habit', and 'archive' to resolve type errors in callers.
export function runWorkerTask<T>(type: 'encrypt' | 'decrypt' | 'build-ai-prompt' | 'build-quote-analysis-prompt' | 'prune-habit' | 'archive', payload: any, key?: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const id = generateUUID();
        workerCallbacks.set(id, { resolve, reject });
        getWorker().postMessage({ id, type, payload, key });
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

async function resolveConflictWithServerState(serverPayload: ServerPayload) {
    addSyncLog("Conflito detectado. Iniciando Smart Merge...", "info", "🧩");
    const syncKey = getSyncKey();
    if (!syncKey) return setSyncStatus('syncError');
    
    try {
        addSyncLog("Baixando estado remoto para fusão...", "info", "⬇️");
        const serverState = await runWorkerTask<AppState>('decrypt', serverPayload.state, syncKey);
        const localState = getPersistableState();
        
        addSyncLog("Executando fusão inteligente (Smart Merge)...", "info", "🧠");
        const mergedState = await mergeStates(localState, serverState);
        
        await persistStateLocally(mergedState);
        await loadState(mergedState);
        
        renderApp();
        setSyncStatus('syncSynced');
        addSyncLog("Conflito resolvido via Smart Merge.", "success", "✅");
        syncStateWithCloud(mergedState, true);
    } catch (error: any) {
        addSyncLog(`Falha na resolução de conflito: ${error.message}`, "error", "❌");
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
        isSyncInProgress = false;
        return setSyncStatus('syncError');
    }

    try {
        const sizeInfo = getPayloadSizeString(appState);
        addSyncLog(`Preparando dados para envio (${sizeInfo})...`, "info", "📦");
        
        addSyncLog("Cifrando dados (AES-GCM)...", "info", "🔐");
        const encryptedState = await runWorkerTask<string>('encrypt', appState, syncKey);
        const payload: ServerPayload = { lastModified: appState.lastModified, state: encryptedState };
        
        addSyncLog("Iniciando upload para a nuvem...", "info", "⬆️");
        const response = await apiFetch('/api/sync', { method: 'POST', body: JSON.stringify(payload) }, true);

        if (response.status === 409) {
            const serverPayload: ServerPayload = await response.json();
            await resolveConflictWithServerState(serverPayload);
        } else {
            setSyncStatus('syncSynced');
            addSyncLog("Sincronização na nuvem concluída com sucesso.", "success", "✅");
            document.dispatchEvent(new CustomEvent('habitsChanged'));
        }
    } catch (error: any) {
        addSyncLog(`Erro de rede: ${error.message}`, "error", "❌");
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
        addSyncLog("Verificando atualizações na nuvem...", "info", "🔍");
        const response = await apiFetch('/api/sync', {}, true);
        const data: ServerPayload | null = await response.json();

        if (data && data.state) {
            const sizeInfo = `(${(data.state.length / 1024).toFixed(1)}KB)`;
            addSyncLog(`Dados recebidos ${sizeInfo}. Iniciando decriptografia...`, "info", "⬇️");
            const appState = await runWorkerTask<AppState>('decrypt', data.state, syncKey);
            setSyncStatus('syncSynced');
            addSyncLog("Estado baixado e decifrado com sucesso.", "success", "✅");
            return appState;
        } else if (state.habits.length > 0) {
            addSyncLog("Nuvem vazia. Iniciando upload inicial...", "info", "☁️");
            syncStateWithCloud(getPersistableState(), true);
        }
        return undefined;
    } catch (error: any) {
        addSyncLog(`Falha no download inicial: ${error.message}`, "error", "❌");
        setSyncStatus('syncError');
        throw error;
    }
}
