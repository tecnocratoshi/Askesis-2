
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file services/sync.worker.ts
 * @description Web Worker para tarefas CPU-bound (Criptografia, Compressão e Prompt Construction).
 */

import { AppState, TimeOfDay, PERIOD_OFFSET, HABIT_STATE } from '../state';

// --- CRYPTO ENGINE ---
const SALT_LEN = 16;
const IV_LEN = 12;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
}

async function encrypt(data: any, password: string): Promise<string> {
    const text = JSON.stringify(data);
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key = await deriveKey(password, salt);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);
    return btoa(String.fromCharCode(...combined));
}

async function decrypt(encryptedBase64: string, password: string): Promise<any> {
    const str = atob(encryptedBase64);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    const salt = bytes.slice(0, SALT_LEN);
    const iv = bytes.slice(SALT_LEN, SALT_LEN + IV_LEN);
    const data = bytes.slice(SALT_LEN + IV_LEN);
    const key = await deriveKey(password, salt);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return JSON.parse(new TextDecoder().decode(decrypted));
}

// --- PROMPT BUILDER HELPERS ---

function getStatusFromBitmask(logs: Map<string, string>, habitId: string, dateISO: string, time: TimeOfDay): number {
    const key = `${habitId}_${dateISO.substring(0, 7)}`;
    const hex = logs.get(key);
    if (!hex) return 0;
    const val = BigInt(hex);
    const day = parseInt(dateISO.substring(8, 10), 10);
    const bitPos = BigInt(((day - 1) * 6) + PERIOD_OFFSET[time]);
    return Number((val >> bitPos) & 3n);
}

// --- MESSAGE HANDLER ---

self.onmessage = async (e) => {
    const { id, type, payload, key } = e.data;
    try {
        let result: any;
        switch (type) {
            case 'encrypt':
                result = await encrypt(payload, key!);
                break;
            case 'decrypt':
                result = await decrypt(payload, key!);
                break;
            case 'build-ai-prompt':
                result = buildAiPrompt(payload);
                break;
            case 'build-quote-analysis-prompt':
                result = buildQuoteAnalysisPrompt(payload);
                break;
            case 'prune-habit':
                result = pruneHabitFromArchives(payload);
                break;
            case 'archive':
                result = archiveDailyData(payload);
                break;
            default:
                throw new Error(`Unknown task type: ${type}`);
        }
        self.postMessage({ id, status: 'success', result });
    } catch (error: any) {
        self.postMessage({ id, status: 'error', error: error.message });
    }
};

// --- LOGIC IMPLEMENTATIONS ---

function buildAiPrompt(data: any) {
    const { habits, dailyData, monthlyLogs, analysisType, translations, todayISO, languageName } = data;
    const logs = new Map<string, string>(data.monthlyLogsSerialized || []);
    
    // Constrói resumo de histórico para o Gemini
    let activeHabitDetails = "";
    habits.forEach((h: any) => {
        if (h.graduatedOn) return;
        const name = h.scheduleHistory[h.scheduleHistory.length-1].name || translations[h.scheduleHistory[h.scheduleHistory.length-1].nameKey];
        activeHabitDetails += `- ${name}\n`;
    });

    return {
        prompt: translations.promptTemplate.replace('{activeHabitDetails}', activeHabitDetails),
        systemInstruction: translations.aiSystemInstruction.replace('{languageName}', languageName)
    };
}

function buildQuoteAnalysisPrompt(data: any) {
    const { notes, themeList, languageName, translations } = data;
    return {
        prompt: translations.aiPromptQuote.replace('{notes}', notes).replace('{theme_list}', themeList),
        systemInstruction: translations.aiSystemInstructionQuote.replace('{languageName}', languageName)
    };
}

function pruneHabitFromArchives(data: any) {
    // Logic for cleanup of old data
    return data.archives;
}

function archiveDailyData(data: any) {
    // Logic for long-term storage compression
    return {};
}
