
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
import { addSyncLog } from './cloud';

/**
 * Mescla registros diários.
 */
function mergeDayRecord(source: Record<string, HabitDailyInfo>, target: Record<string, HabitDailyInfo>, preserveNotes = true) {
    let mergedCount = 0;
    for (const habitId in source) {
        if (!target[habitId]) {
            target[habitId] = source[habitId];
            mergedCount++;
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
        mergedCount++;
    }
    return mergedCount;
}

export async function mergeStates(local: AppState, incoming: AppState): Promise<AppState> {
    const localTs = local.lastModified || 0;
    const incomingTs = incoming.lastModified || 0;
    const todayISO = getTodayUTCIso();
    
    addSyncLog("Executando fusão inteligente (Smart Merge)...", "info", "🧠");

    let winner = localTs > incomingTs ? local : incoming;
    let loser = localTs > incomingTs ? incoming : local;
    
    const merged: AppState = structuredClone(winner);
    
    // 2. Habits Union
    const mergedIds = new Set(merged.habits.map(h => h.id));
    let newHabitsCount = 0;
    loser.habits.forEach(h => {
        if (!mergedIds.has(h.id)) {
            (merged.habits as any).push(h);
            newHabitsCount++;
        }
    });
    if (newHabitsCount > 0) addSyncLog(`${newHabitsCount} novos hábitos importados.`, "info", "✨");

    // 3. Daily Data Merge
    let recordsCount = 0;
    for (const date in loser.dailyData) {
        if (!merged.dailyData[date]) {
            (merged.dailyData as any)[date] = loser.dailyData[date];
            recordsCount++;
        } else if (date !== todayISO) {
            recordsCount += mergeDayRecord(loser.dailyData[date], (merged.dailyData as any)[date]);
        }
    }

    // --- PRIORIDADE ABSOLUTA PARA HOJE (Cloud Wins) ---
    if (incoming.dailyData[todayISO]) {
        if (!merged.dailyData[todayISO]) (merged.dailyData as any)[todayISO] = {};
        mergeDayRecord(incoming.dailyData[todayISO], (merged.dailyData as any)[todayISO], true);
        addSyncLog("Metadados de hoje sincronizados com a nuvem.", "info", "📅");
    }

    // 5. Monthly Logs (Bitmasks)
    merged.monthlyLogs = HabitService.mergeLogs(winner.monthlyLogs, loser.monthlyLogs);
    
    // --- FORCE TODAY BITMASK FROM CLOUD ---
    if (incoming.monthlyLogs) {
        HabitService.overwriteDayBits(merged.monthlyLogs, incoming.monthlyLogs, todayISO);
        addSyncLog("Estado de conclusão (Bitmask) atualizado via nuvem.", "info", "🔢");
    }

    const now = Date.now();
    merged.lastModified = Math.max(localTs, incomingTs, now) + 1;

    return merged;
}
