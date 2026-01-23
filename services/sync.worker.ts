
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// --- CRYPTO ENGINE ---
const SALT_LEN = 16;
const IV_LEN = 12;

/**
 * Protocolo de Serialização (JSON Bridge):
 * Suporta tipos não primitivos no Worker (BigInt, Map).
 */
function jsonReplacer(key: string, value: any) {
    if (typeof value === 'bigint') return { __type: 'bigint', val: value.toString() };
    if (value instanceof Map) return { __type: 'map', val: Array.from(value.entries()) };
    return value;
}

function jsonReviver(key: string, value: any) {
    if (value && typeof value === 'object') {
        if (value.__type === 'bigint') return BigInt(value.val);
        if (value.__type === 'map') return new Map(value.val);
    }
    return value;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
}

async function encrypt(payload: any, password: string): Promise<string> {
    // A serialização ocorre no Worker para não bloquear a Main Thread
    const text = JSON.stringify(payload, jsonReplacer);

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
    
    // Hidratação completa preservando BigInt e Map
    return JSON.parse(new TextDecoder().decode(decrypted), jsonReviver);
}

// --- MESSAGE HANDLER ---
self.onmessage = async (e) => {
    const { id, type, payload, key } = e.data;
    try {
        let result: any;
        switch (type) {
            case 'encrypt': result = await encrypt(payload, key!); break;
            case 'decrypt': result = await decrypt(payload, key!); break;
            case 'build-ai-prompt': result = buildAiPrompt(payload); break;
            case 'build-quote-analysis-prompt': result = buildQuoteAnalysisPrompt(payload); break;
            case 'archive': result = await archiveDailyData(payload); break;
            case 'prune-habit': result = payload.archives; break;
            default: throw new Error(`Unknown: ${type}`);
        }
        self.postMessage({ id, status: 'success', result });
    } catch (error: any) {
        self.postMessage({ id, status: 'error', error: error.message });
    }
};

function buildAiPrompt(data: any) {
    const { habits, dailyData, translations, languageName } = data;
    let details = "";
    habits.forEach((h: any) => {
        if (h.graduatedOn) return;
        const name = h.scheduleHistory[h.scheduleHistory.length-1].name || translations[h.scheduleHistory[h.scheduleHistory.length-1].nameKey];
        details += `- ${name}\n`;
    });
    return {
        prompt: translations.promptTemplate.replace('{activeHabitDetails}', details).replace('{history}', JSON.stringify(dailyData)),
        systemInstruction: translations.aiSystemInstruction.replace('{languageName}', languageName)
    };
}

function buildQuoteAnalysisPrompt(data: any) {
    return {
        prompt: data.translations.aiPromptQuote.replace('{notes}', data.notes).replace('{theme_list}', data.themeList),
        systemInstruction: data.translations.aiSystemInstructionQuote
    };
}

async function archiveDailyData(payload: any) {
    const result: Record<string, any> = {};
    for (const year in payload) {
        result[year] = { ...payload[year].base, ...payload[year].additions };
    }
    return result;
}
