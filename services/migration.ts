
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
            hasOnboarded: false, // Fresh installs need onboarding
            monthlyLogs: new Map()
        } as AppState;
    }

    // 2. SCHEMA ENFORCEMENT & HYDRATION
    const state = loadedState as AppState;

    if (!state.monthlyLogs || !(state.monthlyLogs instanceof Map)) {
        state.monthlyLogs = new Map();
    }

    // HYDRATION: If flag is missing, we assume users with habits have onboarded.
    if ((state as any).hasOnboarded === undefined) {
        (state as any).hasOnboarded = state.habits && state.habits.length > 0;
    }

    (state as any).version = targetVersion;
    
    return state;
}
