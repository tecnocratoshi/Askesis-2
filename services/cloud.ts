
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * VERSÃO: V18.7 - With Telemetry Logging
 */

import { AppState, state, getPersistableState } from '../state';
import { persistStateLocally } from './persistence';
import { ui } from '../render/ui';
import { t } from '../i18n';
import { hasLocalSyncKey, getSyncKey, apiFetch } from './api';
import { encrypt, decrypt } from './crypto';
import { mergeStates } from './dataMerge';
import { compressToBuffer, decompressFromBuffer, decompressString } from '../utils';

const DEBOUNCE_DELAY = 2000;
const MAX_LOG_SIZE = 50; // Keep logs clean
let syncTimeout: any = null;
let isSyncInProgress = false;

// --- TELEMETRY LOGGING ---

function addSyncLog(msg: string, type: 'info' | 'error' | 'success' = 'info') {
    state.syncLogs.unshift({ time: Date.now(), msg, type });
    if (state.syncLogs.length > MAX_LOG_SIZE) state.syncLogs.pop();
    // Non-blocking notification for UI to potentially refresh logs if open
    document.dispatchEvent(new CustomEvent('sync-logs-updated'));
}

// --- SERIALIZATION ENGINE ---

function _jsonReplacer(key: string, value: any): any {
    if (typeof value === 'bigint') {
        return { __type: 'bigint', val: value.toString() };
    }
    if (value instanceof Map) {
        return { __type: 'map', val: Array.from(value.entries()) };
    }
    return value;
}

function _jsonReviver(key: string, value: any): any {
    if (value && typeof value === 'object' && value.__type) {
        if (value.__type === 'bigint') {
            return BigInt(value.val);
        }
        if (value.__type === 'map') {
            return new Map(value.val);
        }
    }
    return value;
}

// --- VIRTUAL WORKER TASKS (Main Thread Async) ---

const TASKS: Record<string, (payload: any) => Promise<any> | any> = {
    'build-ai-prompt': (payload: any) => {
        const { analysisType, languageName, translations } = payload;
        return {
            prompt: `[${languageName}] ${analysisType} Analysis.\nContext: ${JSON.stringify(payload.dailyData || {})}`,
            systemInstruction: translations.aiSystemInstruction || "Act as a Stoic Mentor."
        };
    },
    'build-quote-analysis-prompt': (payload: any) => {
        return {
            prompt: payload.translations.aiPromptQuote.replace('{notes}', payload.notes).replace('{theme_list}', payload.themeList),
            systemInstruction: payload.translations.aiSystemInstructionQuote
        };
    },
    'archive': async (payload: any) => {
        const result: Record<string, Uint8Array> = {};
        const years = Object.keys(payload);
        for (const year of years) {
            const { additions, base } = payload[year];
            let baseObj = {};
            if (base) {
                if (typeof base === 'object' && !(base instanceof Uint8Array)) {
                    baseObj = base;
                } else {
                    try {
                        let jsonStr = '';
                        if (base instanceof Uint8Array) jsonStr = await decompressFromBuffer(base);
                        else if (typeof base === 'string') jsonStr = base.startsWith('GZIP:') ? await decompressString(base.substring(5)) : base;
                        baseObj = JSON.parse(jsonStr);
                    } catch (e) { baseObj = {}; }
                }
            }
            const merged = { ...baseObj, ...additions };
            try {
                const compressed = await compressToBuffer(JSON.stringify(merged));
                result[year] = compressed;
            } catch (e) { throw e; }
        }
        return result;
    },
    'prune-habit': (payload: any) => payload.archives
};

export function runWorkerTask<T>(type: string, payload: any): Promise<T> {
    return new Promise((resolve, reject) => {
        const scheduler = (window as any).scheduler;
        const runner = async () => {
            try {
                const handler = TASKS[type];
                if (!handler) throw new Error(`Unknown task: ${type}`);
                const result = await handler(payload);
                resolve(result);
            } catch (e) { reject(e); }
        };
        if (scheduler?.postTask) scheduler.postTask(runner, { priority: 'background' });
        else setTimeout(runner, 0);
    });
}

// --- SYNC STATUS UI ---

export function setSyncStatus(statusKey: 'syncSaving' | 'syncSynced' | 'syncError' | 'syncInitial' | 'syncing') {
    state.syncState = statusKey === 'syncing' ? 'syncSaving' : statusKey;
    const displayKey = statusKey === 'syncing' ? 'syncSaving' : statusKey;
    if (ui.syncStatus) ui.syncStatus.textContent = t(displayKey);
}

// --- CLOUD SYNC CORE ---

export async function downloadRemoteState(key: string): Promise<AppState | null> {
    try {
        addSyncLog("Iniciando descarga de dados...", "info");
        const res = await apiFetch('/api/sync', { method: 'GET' }, true);
        if (res.status === 404) { addSyncLog("Nenhum dado encontrado na nuvem.", "info"); return null; }
        if (res.status === 401) throw new Error("Chave Inválida (401)");
        if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
        const data = await res.json();
        if (!data || !data.state) return null;
        addSyncLog(`Dados recebidos (${Math.round(data.state.length / 1024)}KB). Iniciando decriptografia...`);
        const jsonString = await decrypt(data.state, key);
        addSyncLog("Dados descriptografados e descompressos com sucesso.", "success");
        return JSON.parse(jsonString, _jsonReviver);
    } catch (e: any) {
        addSyncLog(`Falha na descarga: ${e.message}`, "error");
        throw e;
    }
}

export async function fetchStateFromCloud(): Promise<AppState | null> {
    if (!hasLocalSyncKey()) return null;
    const key = getSyncKey();
    if (!key) return null;
    try {
        setSyncStatus('syncing');
        const remoteState = await downloadRemoteState(key);
        if (!remoteState) { setSyncStatus('syncSynced'); return null; }
        const localState = getPersistableState();
        if (!localState.monthlyLogs && state.monthlyLogs) localState.monthlyLogs = state.monthlyLogs;
        addSyncLog("Executando fusão inteligente de dados (Smart Merge)...");
        const mergedState = await mergeStates(localState, remoteState);
        Object.assign(state, mergedState);
        await persistStateLocally(mergedState);
        document.dispatchEvent(new CustomEvent('render-app'));
        setSyncStatus('syncSynced');
        addSyncLog("Estado local atualizado com sucesso.", "success");
        return mergedState;
    } catch (e: any) {
        state.syncLastError = e.message;
        setSyncStatus('syncError');
        return null;
    }
}

async function _performSync() {
    const key = getSyncKey();
    if (!key) return;
    try {
        isSyncInProgress = true;
        setSyncStatus('syncing');
        addSyncLog("Preparando dados para envio...");
        const rawState = getPersistableState();
        rawState.monthlyLogs = state.monthlyLogs;
        const jsonString = JSON.stringify(rawState, _jsonReplacer);
        addSyncLog(`Serialização completa (${Math.round(jsonString.length/1024)}KB). Criptografando...`);
        const encryptedData = await encrypt(jsonString, key);
        addSyncLog(`Criptografia finalizada. Enviando payload (${Math.round(encryptedData.length/1024)}KB)...`);
        const res = await apiFetch('/api/sync', { method: 'POST', body: JSON.stringify({ lastModified: Date.now(), state: encryptedData }) }, true);
        if (res.status === 409) {
            addSyncLog("Conflito detectado (409). Baixando versão mais recente para merge...", "info");
            await fetchStateFromCloud(); 
        } else if (!res.ok) {
            throw new Error(`Erro Servidor: ${res.status}`);
        } else {
            setSyncStatus('syncSynced');
            state.syncLastError = null;
            addSyncLog("Sincronização na nuvem concluída com sucesso.", "success");
        }
    } catch (e: any) {
        state.syncLastError = e.message || "Erro de Conexão";
        setSyncStatus('syncError');
        addSyncLog(`Falha no envio: ${state.syncLastError}`, "error");
    } finally { isSyncInProgress = false; }
}

export function syncStateWithCloud(currentState?: AppState, immediate = false) {
    if (!hasLocalSyncKey()) return;
    if (syncTimeout) clearTimeout(syncTimeout);
    if (immediate) _performSync();
    else syncTimeout = setTimeout(() => _performSync(), DEBOUNCE_DELAY);
}

if (hasLocalSyncKey()) {
    setTimeout(fetchStateFromCloud, 1500);
}
