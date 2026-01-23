
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
            hasOnboarded: true, // Default to true as initialization handles the actual logic
            syncLogs: [],
            monthlyLogs: new Map() 
        } as AppState;
    }

    const state = loadedState as AppState;

    // 2. SCHEMA ENFORCEMENT & HYDRATION
    if (!state.monthlyLogs || !(state.monthlyLogs instanceof Map)) {
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
