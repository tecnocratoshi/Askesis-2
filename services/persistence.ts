/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file services/persistence.ts
 * @description Camada de Persistência e Gerenciamento de Ciclo de Vida de Dados (Storage Engine).
 */

import { state, AppState, Habit, HabitDailyInfo, APP_VERSION, getPersistableState } from '../state';
import { migrateState } from './migration';
import { HabitService } from './HabitService';
import { clearHabitDomCache } from '../render';

const DB_NAME = 'AskesisDB', DB_VERSION = 1, STORE_NAME = 'app_state';
const STATE_JSON_KEY = 'askesis_core_json';
const STATE_BINARY_KEY = 'askesis_logs_binary';

const DB_OPEN_TIMEOUT_MS = 15000, IDB_SAVE_DEBOUNCE_MS = 800;
let dbPromise: Promise<IDBDatabase> | null = null;
let saveTimeout: number | undefined;
let activeSavePromise: Promise<void> | null = null;
let pendingSaveResolve: (() => void) | null = null;

function getDB(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => { dbPromise = null; reject(new Error("Timeout IDB")); }, DB_OPEN_TIMEOUT_MS);
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = (e.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
            };
            request.onsuccess = (e) => {
                clearTimeout(timeoutId);
                const db = (e.target as IDBOpenDBRequest).result;
                db.onclose = db.onversionchange = () => dbPromise = null;
                resolve(db);
            };
            request.onerror = () => { clearTimeout(timeoutId); dbPromise = null; reject(request.error); };
        });
    }
    return dbPromise;
}

async function saveSplitState(main: AppState): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        const logs = main.monthlyLogs;
        const jsonState = { ...main };
        delete (jsonState as any).monthlyLogs;
        
        store.put(jsonState, STATE_JSON_KEY);
        
        if (logs && logs.size > 0) {
            store.put(logs, STATE_BINARY_KEY);
        }
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

let syncHandler: ((state: AppState, immediate?: boolean) => void) | null = null;
export const registerSyncHandler = (h: (s: AppState, immediate?: boolean) => void) => syncHandler = h;

function pruneOrphanedDailyData(habits: readonly Habit[], dailyData: Record<string, Record<string, HabitDailyInfo>>) {
    if (habits.length === 0) return; 
    const validIds = new Set(habits.map(h => h.id));
    for (const date in dailyData) {
        for (const id in dailyData[date]) {
            if (!validIds.has(id)) {
                delete dailyData[date][id];
            }
        }
        if (Object.keys(dailyData[date]).length === 0) delete dailyData[date];
    }
}

async function saveStateInternal(immediate = false, suppressSync = false) {
    // Serializa o acesso ao IDB para evitar colisões de transação
    if (activeSavePromise) await activeSavePromise;

    activeSavePromise = (async () => {
        state.lastModified = Math.max(Date.now(), state.lastModified + 1);
        const structuredData = getPersistableState();
        try {
            await saveSplitState(structuredData);
        } catch (e) { 
            console.error("IDB Save Failed:", e); 
        }
        
        if (!suppressSync) {
            syncHandler?.(structuredData, immediate);
        }
    })();

    try {
        await activeSavePromise;
    } finally {
        activeSavePromise = null;
    }
}

export function cancelPendingSave() {
    if (saveTimeout !== undefined) {
        clearTimeout(saveTimeout);
        saveTimeout = undefined;
    }
    if (pendingSaveResolve) {
        pendingSaveResolve();
        pendingSaveResolve = null;
    }
}

export async function flushSaveBuffer(): Promise<void> {
    if (saveTimeout !== undefined) {
        clearTimeout(saveTimeout);
        saveTimeout = undefined;
        const resolve = pendingSaveResolve;
        pendingSaveResolve = null;
        await saveStateInternal(true);
        resolve?.();
    }
}

/**
 * Persiste o estado da aplicação.
 * @param immediate Se true, limpa o buffer e salva instantaneamente.
 * @param suppressSync Se true, evita disparar o syncHandler.
 */
export async function saveState(immediate = false, suppressSync = false): Promise<void> {
    if (saveTimeout !== undefined) {
        clearTimeout(saveTimeout);
        saveTimeout = undefined;
    }

    if (immediate) {
        const resolve = pendingSaveResolve;
        pendingSaveResolve = null;
        await saveStateInternal(true, suppressSync);
        resolve?.();
    } else {
        return new Promise((resolve) => {
            const oldResolve = pendingSaveResolve;
            pendingSaveResolve = () => {
                oldResolve?.();
                resolve();
            };

            saveTimeout = self.setTimeout(async () => {
                saveTimeout = undefined;
                const currentResolve = pendingSaveResolve;
                pendingSaveResolve = null;
                await saveStateInternal(false, suppressSync);
                currentResolve?.();
            }, IDB_SAVE_DEBOUNCE_MS);
        });
    }
}

export const persistStateLocally = (data: AppState, suppressSync = false) => {
    return saveState(true, suppressSync);
};

export async function loadState(cloudState?: AppState): Promise<AppState | null> {
    let mainState = cloudState;
    let binaryLogs: any;

    if (!mainState) {
        try {
            const db = await getDB();
            await new Promise<void>((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                
                const reqMain = store.get(STATE_JSON_KEY);
                const reqLogs = store.get(STATE_BINARY_KEY);
                
                tx.oncomplete = () => {
                    mainState = reqMain.result;
                    binaryLogs = reqLogs.result;
                    resolve();
                };
                tx.onerror = () => resolve();
            });
        } catch (e) {
            console.warn("[Persistence] Failed to read state from IDB", e);
        }
    }

    if (mainState) {
        let migrated = migrateState(mainState, APP_VERSION);
        
        if (binaryLogs instanceof Map && binaryLogs.size > 0) {
            state.monthlyLogs = binaryLogs as Map<string, bigint>;
        } 
        else if ((migrated as any).monthlyLogsSerialized) {
            HabitService.deserializeLogsFromCloud((migrated as any).monthlyLogsSerialized);
            delete (migrated as any).monthlyLogsSerialized;
        }
        else if (migrated.monthlyLogs instanceof Map) {
            state.monthlyLogs = migrated.monthlyLogs;
        } else {
            state.monthlyLogs = new Map();
        }

        state.habits = [...(migrated.habits || [])];
        state.lastModified = migrated.lastModified || Date.now();
        state.dailyData = migrated.dailyData || {};
        state.archives = migrated.archives || {};
        state.dailyDiagnoses = migrated.dailyDiagnoses || {};
        state.notificationsShown = [...(migrated.notificationsShown || [])];
        state.pending21DayHabitIds = [...(migrated.pending21DayHabitIds || [])];
        state.pendingConsolidationHabitIds = [...(migrated.pendingConsolidationHabitIds || [])];
        state.hasOnboarded = migrated.hasOnboarded ?? true;
        state.syncLogs = migrated.syncLogs || [];

        ['streaksCache', 'scheduleCache', 'activeHabitsCache', 'unarchivedCache', 'habitAppearanceCache', 'daySummaryCache'].forEach(k => (state as any)[k].clear());
        
        clearHabitDomCache();
        Object.assign(state.uiDirtyState, { calendarVisuals: true, habitListStructure: true, chartData: true });
        
        const runCleanup = () => pruneOrphanedDailyData(state.habits, state.dailyData);
        if ('scheduler' in window && (window as any).scheduler) {
             (window as any).scheduler.postTask(runCleanup, { priority: 'background' });
        }

        document.dispatchEvent(new CustomEvent('render-app'));
        return migrated;
    }
    return null;
}

export const clearLocalPersistence = async () => {
    cancelPendingSave();
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        await new Promise(r => tx.oncomplete = r);
    } catch (e) {
        console.warn("IDB clear failed", e);
    }
    state.monthlyLogs = new Map();
};