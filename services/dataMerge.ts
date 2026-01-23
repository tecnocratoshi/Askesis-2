
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file services/dataMerge.ts
 * @description Algoritmo de Reconciliação de Estado (Smart Merge / CRDT-lite).
 */

import { AppState, HabitDailyInfo } from '../state';
import { HabitService } from './HabitService';
import { getTodayUTCIso } from '../utils';

/**
 * Hidrata monthlyLogs garantindo que BigInts e Maps sejam reconstruídos corretamente.
 */
function hydrateLogs(state: AppState) {
    if (state.monthlyLogs && !(state.monthlyLogs instanceof Map)) {
        const entries = Array.isArray(state.monthlyLogs) 
            ? state.monthlyLogs 
            : Object.entries(state.monthlyLogs);
            
        const map = new Map<string, bigint>();
        entries.forEach((item: any) => {
            const key = Array.isArray(item) ? item[0] : item[0];
            const val = Array.isArray(item) ? item[1] : item[1];
            
            try {
                if (val && typeof val === 'object' && val.__type === 'bigint') {
                    map.set(key, BigInt(val.val));
                } else if (typeof val === 'string' && val.startsWith('0x')) {
                    map.set(key, BigInt(val));
                } else {
                    map.set(key, BigInt(val));
                }
            } catch(e) {
                console.warn(`[Merge] Failed to hydrate bitmask for ${key}`);
            }
        });
        state.monthlyLogs = map;
    }
}

/**
 * Mescla registros diários (Notas e Overrides).
 */
function mergeDayRecord(source: Record<string, HabitDailyInfo>, target: Record<string, HabitDailyInfo>) {
    for (const habitId in source) {
        if (!target[habitId]) {
            target[habitId] = source[habitId];
            continue;
        }

        const sourceInstances = source[habitId].instances || {};
        const targetInstances = target[habitId].instances || {};

        for (const time in sourceInstances) {
            const srcInst = sourceInstances[time as any];
            const tgtInst = targetInstances[time as any];

            if (!srcInst) continue;
            if (!tgtInst) {
                targetInstances[time as any] = srcInst;
            } else {
                // Preserva nota mais longa ou override mais recente
                if ((srcInst.note?.length || 0) > (tgtInst.note?.length || 0)) {
                    tgtInst.note = srcInst.note;
                }
                if (srcInst.goalOverride !== undefined) {
                    tgtInst.goalOverride = srcInst.goalOverride;
                }
            }
        }
        
        if (source[habitId].dailySchedule) {
             target[habitId].dailySchedule = source[habitId].dailySchedule;
        }
    }
}

export async function mergeStates(local: AppState, incoming: AppState): Promise<AppState> {
    hydrateLogs(local);
    hydrateLogs(incoming);

    const localTs = local.lastModified || 0;
    const incomingTs = incoming.lastModified || 0;
    
    // Define base pelo mais recente
    let winner = localTs > incomingTs ? local : incoming;
    let loser = localTs > incomingTs ? incoming : local;
    
    const merged: AppState = structuredClone(winner);
    
    // 1. União de Hábitos (por ID)
    const mergedIds = new Set(merged.habits.map(h => h.id));
    loser.habits.forEach(h => {
        if (!mergedIds.has(h.id)) {
            (merged.habits as any).push(h);
        }
    });

    // 2. Mesclagem de Dados Diários (Notas/Overrides)
    for (const date in loser.dailyData) {
        if (!merged.dailyData[date]) {
            (merged.dailyData as any)[date] = loser.dailyData[date];
        } else {
            mergeDayRecord(loser.dailyData[date], (merged.dailyData as any)[date]);
        }
    }

    // 3. Mesclagem de Logs de Status (Bitmasks) - CRÍTICO
    merged.monthlyLogs = HabitService.mergeLogs(winner.monthlyLogs, loser.monthlyLogs);
    
    // 4. Integridade Temporal
    merged.lastModified = Math.max(localTs, incomingTs, Date.now()) + 1;

    return merged;
}
