
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
 * Hidrata monthlyLogs se vieram como Array bruto ou Objeto (do JSON sem reviver completo).
 */
function hydrateLogs(state: AppState) {
    if (state.monthlyLogs && !(state.monthlyLogs instanceof Map)) {
        // Se for um array de entradas (standard Map serialization) ou um objeto plano
        const entries = Array.isArray(state.monthlyLogs) 
            ? state.monthlyLogs 
            : Object.entries(state.monthlyLogs);
            
        const map = new Map<string, bigint>();
        entries.forEach((item: any) => {
            // Suporta [key, value] (Array) ou {key, value} (Object entries)
            const key = Array.isArray(item) ? item[0] : item[0];
            const val = Array.isArray(item) ? item[1] : item[1];
            
            try {
                // Tenta converter para BigInt se não for um.
                // Aceita BigInt nativo, strings numéricas ou hex "0x..."
                map.set(key, typeof val === 'bigint' ? val : BigInt(val));
            } catch(e) {
                console.warn(`[Merge] Failed to hydrate bitmask for ${key}:`, val);
            }
        });
        state.monthlyLogs = map;
    }
}

/**
 * Mescla registros diários.
 */
function mergeDayRecord(source: Record<string, HabitDailyInfo>, target: Record<string, HabitDailyInfo>, preserveNotes = true) {
    for (const habitId in source) {
        if (!target[habitId]) {
            target[habitId] = source[habitId];
            continue;
        }

        const sourceHabitData = source[habitId];
        const targetHabitData = target[habitId];

        const sourceInstances = sourceHabitData.instances || {};
        const targetInstances = targetHabitData.instances || {};

        for (const time in sourceInstances) {
            const srcInst = sourceInstances[time as any];
            const tgtInst = targetInstances[time as any];

            if (!srcInst) continue;

            if (!tgtInst) {
                targetInstances[time as any] = srcInst;
            } else {
                if (preserveNotes) {
                    const sNoteLen = srcInst.note ? srcInst.note.length : 0;
                    const tNoteLen = tgtInst.note ? tgtInst.note.length : 0;
                    
                    if ((!srcInst.note && tgtInst.note) || (tgtInst.note && tNoteLen > sNoteLen)) {
                        srcInst.note = tgtInst.note;
                    }
                }
                targetInstances[time as any] = srcInst;
            }
        }
        
        if (sourceHabitData.dailySchedule) {
             targetHabitData.dailySchedule = sourceHabitData.dailySchedule;
        }
    }
}

export async function mergeStates(local: AppState, incoming: AppState): Promise<AppState> {
    // Sanitização de Tipos (Anti-Crash)
    hydrateLogs(local);
    hydrateLogs(incoming);

    const localTs = local.lastModified || 0;
    const incomingTs = incoming.lastModified || 0;
    const todayISO = getTodayUTCIso();
    
    // 1. Define Base (Vencedor) por Timestamp
    let winner = localTs > incomingTs ? local : incoming;
    let loser = localTs > incomingTs ? incoming : local;
    
    const merged: AppState = structuredClone(winner);
    
    // 2. Habits Union
    const mergedIds = new Set(merged.habits.map(h => h.id));
    loser.habits.forEach(h => {
        if (!mergedIds.has(h.id)) {
            (merged.habits as any).push(h);
        }
    });

    // 3. Daily Data Merge
    for (const date in loser.dailyData) {
        if (!merged.dailyData[date]) {
            (merged.dailyData as any)[date] = loser.dailyData[date];
        } else {
            if (date !== todayISO) {
                mergeDayRecord(loser.dailyData[date], (merged.dailyData as any)[date]);
            }
        }
    }

    // PRIORIDADE ABSOLUTA PARA HOJE (Cloud Wins)
    if (incoming.dailyData[todayISO]) {
        if (!merged.dailyData[todayISO]) {
            (merged.dailyData as any)[todayISO] = {};
        }
        mergeDayRecord(incoming.dailyData[todayISO], (merged.dailyData as any)[todayISO], true);
    }

    // 4. Archives Union
    if (loser.archives) {
        (merged as any).archives = merged.archives || {};
        for (const year in loser.archives) {
            if (!merged.archives[year]) {
                (merged.archives as any)[year] = loser.archives[year];
            }
        }
    }
    
    // 5. Monthly Logs (Bitmasks)
    merged.monthlyLogs = HabitService.mergeLogs(winner.monthlyLogs, loser.monthlyLogs);
    
    // FORCE TODAY BITMASK FROM CLOUD
    if (incoming.monthlyLogs) {
        HabitService.overwriteDayBits(merged.monthlyLogs, incoming.monthlyLogs, todayISO);
    }

    // 6. Time Integrity
    const now = Date.now();
    merged.lastModified = Math.max(localTs, incomingTs, now);
    if (merged.lastModified === Math.max(localTs, incomingTs)) {
        merged.lastModified += 1;
    }

    // Meta Data Merge
    // @ts-ignore
    merged.version = Math.max(local.version || 0, incoming.version || 0);
    const mergeList = (a: readonly any[] | undefined, b: readonly any[] | undefined) => 
        Array.from(new Set([...(a||[]), ...(b||[])]));

    // @ts-ignore
    merged.notificationsShown = mergeList(merged.notificationsShown, loser.notificationsShown);
    // @ts-ignore
    merged.pending21DayHabitIds = mergeList(merged.pending21DayHabitIds, loser.pending21DayHabitIds);
    // @ts-ignore
    merged.pendingConsolidationHabitIds = mergeList(merged.pendingConsolidationHabitIds, loser.pendingConsolidationHabitIds);

    return merged;
}
