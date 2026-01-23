
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file services/migration.ts
 * @description Inicializador de Estado e Sanitizador de Schema.
 */

import { AppState } from '../state';

export function migrateState(loadedState: any, targetVersion: number): AppState {
    // 1. FRESH INSTALL / NULL STATE
    if (!loadedState) {
        return { 
            version: targetVersion, 
            habits: [], 
            dailyData: {}, 
            archives: {}, 
            dailyDiagnoses: {}, 
            lastModified: Date.now(), 
            notificationsShown: [], 
            pending21DayHabitIds: [], 
            pendingConsolidationHabitIds: [], 
            hasOnboarded: true,
            syncLogs: [],
            monthlyLogs: new Map() 
        } as AppState;
    }

    const state = loadedState as AppState;

    // 2. SCHEMA ENFORCEMENT & HYDRATION (Critical fix for Map/BigInt)
    if (state.monthlyLogs && !(state.monthlyLogs instanceof Map)) {
        try {
            // Tenta converter objeto/array plano vindo do JSON para Map<string, bigint>
            const entries = Array.isArray(state.monthlyLogs) 
                ? state.monthlyLogs 
                : Object.entries(state.monthlyLogs);
                
            state.monthlyLogs = new Map(entries.map(([k, v]: [string, any]) => {
                let val = v;
                // Trata objetos de transporte do Worker { __type: 'bigint', val: "..." }
                if (v && typeof v === 'object' && v.__type === 'bigint') {
                    val = BigInt(v.val);
                } else if (typeof v !== 'bigint') {
                    val = BigInt(v);
                }
                return [k, val];
            }));
        } catch (e) {
            console.warn("[Migration] Failed to hydrate monthlyLogs, starting fresh Map.", e);
            state.monthlyLogs = new Map();
        }
    } else if (!state.monthlyLogs) {
        state.monthlyLogs = new Map();
    }

    if (state.hasOnboarded === undefined) {
        (state as any).hasOnboarded = true;
    }

    if (!state.syncLogs) {
        (state as any).syncLogs = [];
    }

    // Force target version
    (state as any).version = targetVersion;
    
    return state;
}