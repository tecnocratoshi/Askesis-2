
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file cloud.ts
 * @description Orquestrador de Sincronização e Ponte para Web Workers (Main Thread Client).
 */

import { AppState, state, getPersistableState } from './state';
import { loadState, persistStateLocally } from './services/persistence';
import { pushToOneSignal, generateUUID } from './utils';
import { ui } from './render/ui';
import { t } from './i18n';
import { hasLocalSyncKey, getSyncKey, apiFetch } from './services/api';
import { renderApp, updateNotificationUI } from './render';
import { mergeStates } from './services/dataMerge';

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
    /**
     * @license
     * SPDX-License-Identifier: Apache-2.0
    */

    /**
     * @file cloud.ts
     * @description Shim de compatibilidade. Use `services/cloud.ts`.
     */

    export * from './services/cloud';
        getWorker().postMessage({ id, type, payload, key });
