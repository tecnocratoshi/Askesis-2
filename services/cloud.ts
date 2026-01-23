/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * VERSÃO: V18.8 - Enhanced Telemetry & Main Sync Compression
 */

import { AppState, state, getPersistableState } from '../state';
import { persistStateLocally } from './persistence';
import { ui } from '../render/ui';
import { t } from '../i18n';
import { hasLocalSyncKey, getSyncKey, apiFetch } from './api';
import { encrypt, decrypt } from './crypto';
import { mergeStates } from './dataMerge';
import { compressToBuffer, decompressFromBuffer, arrayBufferToBase64, base64ToArrayBuffer } from '../utils';

const DEBOUNCE_DELAY = 2000;
const MAX_LOG_SIZE = 100; // Increased for more detail
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
                        else if (typeof base === 'string') jsonStr = base.startsWith('GZIP:') ? await decompressFromBuffer(base64ToArrayBuffer(base.substring(5))) : base;
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
    state.syncState = statusKey === 'syncing' ? 'syncSaving' : (statusKey as any);
    const displayKey = statusKey === 'syncing' ? 'syncSaving' : statusKey;
    if (ui.syncStatus) ui.syncStatus.textContent = t(displayKey);
}

// --- CLOUD SYNC CORE ---

export async function downloadRemoteState(key: string): Promise<AppState | null> {
    try {
        addSyncLog("Solicitando dados da nuvem...", "info");
        const res = await apiFetch('/api/sync', { method: 'GET' }, true);
        if (res.status === 404) { addSyncLog("Nenhum dado encontrado no servidor.", "info"); return null; }
        if (res.status === 401) throw new Error("Não autorizado: Verifique sua chave.");
        if (!res.ok) throw new Error(`Servidor respondeu com erro ${res.status}`);
        
        const data = await res.json();
        if (!data || !data.state) { addSyncLog("Payload da nuvem vazio."); return null; }
        
        const encryptedLen = data.state.length;
        addSyncLog(`Descarga completa: ${Math.round(encryptedLen / 1024)}KB recebidos (Criptografados).`);
        
        addSyncLog("Iniciando decriptografia...", "info");
        let jsonString = await decrypt(data.state, key);
        addSyncLog("Decriptografia AES-GCM concluída.");

        // Check for GZIP compression header
        if (jsonString.startsWith('GZIP:')) {
            const compressedB64 = jsonString.substring(5);
            addSyncLog(`Detectado payload comprimido (${Math.round(compressedB64.length / 1024)}KB). Descomprimindo...`, "info");
            const buffer = base64ToArrayBuffer(compressedB64);
            jsonString = await decompressFromBuffer(buffer);
            addSyncLog(`Descompressão finalizada: ${Math.round(jsonString.length / 1024)}KB de dados puros (JSON).`, "success");
        } else {
            addSyncLog(`Payload não comprimido: ${Math.round(jsonString.length / 1024)}KB de JSON.`);
        }

        return JSON.parse(jsonString, _jsonReviver);
    } catch (e: any) {
        addSyncLog(`Erro na descarga/processamento: ${e.message}`, "error");
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
        
        addSyncLog("Iniciando fusão de dados (Merge)...", "info");
        const mergedState = await mergeStates(localState, remoteState);
        
        addSyncLog("Atualizando estado local e persistência...", "info");
        Object.assign(state, mergedState);
        await persistStateLocally(mergedState);
        
        document.dispatchEvent(new CustomEvent('render-app'));
        setSyncStatus('syncSynced');
        addSyncLog("Sincronização de entrada (PULL) concluída com sucesso.", "success");
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
        addSyncLog("Preparando snapshot para envio...", "info");
        
        const rawState = getPersistableState();
        rawState.monthlyLogs = state.monthlyLogs;
        let finalPayload = JSON.stringify(rawState, _jsonReplacer);
        const rawSize = finalPayload.length;
        addSyncLog(`JSON serializado: ${Math.round(rawSize/1024)}KB.`);

        // Apply Compression
        addSyncLog("Comprimindo dados (GZIP Stream API)...", "info");
        const compressedBuffer = await compressToBuffer(finalPayload);
        const compressedB64 = arrayBufferToBase64(compressedBuffer);
        finalPayload = "GZIP:" + compressedB64;
        const compSize = finalPayload.length;
        const ratio = Math.round((1 - compSize / rawSize) * 100);
        addSyncLog(`Compressão concluída: ${Math.round(compSize/1024)}KB (${ratio}% de economia).`, "info");

        addSyncLog("Criptografando payload com AES-GCM...", "info");
        const encryptedData = await encrypt(finalPayload, key);
        addSyncLog(`Criptografia finalizada: ${Math.round(encryptedData.length/1024)}KB prontos para envio.`);

        addSyncLog("Enviando para o servidor (POST /api/sync)...", "info");
        const res = await apiFetch('/api/sync', { 
            method: 'POST', 
            body: JSON.stringify({ 
                lastModified: Date.now(), 
                state: encryptedData 
            }) 
        }, true);

        if (res.status === 409) {
            addSyncLog("Conflito detectado (409): O servidor possui uma versão mais recente.", "error");
            await fetchStateFromCloud(); 
        } else if (!res.ok) {
            throw new Error(`Erro de rede: ${res.status}`);
        } else {
            setSyncStatus('syncSynced');
            state.syncLastError = null;
            addSyncLog("Sincronização de saída (PUSH) concluída com sucesso.", "success");
        }
    } catch (e: any) {
        state.syncLastError = e.message || "Erro desconhecido";
        setSyncStatus('syncError');
        addSyncLog(`Falha no envio: ${state.syncLastError}`, "error");
    } finally { 
        isSyncInProgress = false; 
    }
}

export function syncStateWithCloud(currentState?: AppState, immediate = false) {
    if (!hasLocalSyncKey()) return;
    if (syncTimeout) clearTimeout(syncTimeout);
    if (immediate) _performSync();
    else syncTimeout = setTimeout(() => _performSync(), DEBOUNCE_DELAY);
}

if (hasLocalSyncKey()) {
    // Initial delay for smooth boot
    setTimeout(fetchStateFromCloud, 2000);
}