/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file services/dataMerge.ts
 * @description Algoritmo de Reconciliação de Estado (Smart Merge / CRDT-lite).
 */

import { AppState, HabitDailyInfo, Habit, HabitSchedule } from '../state';
import { HabitService } from './HabitService';

/**
 * Hidrata monthlyLogs garantindo que BigInts e Maps sejam reconstruídos corretamente.
 */
function hydrateLogs(appState: AppState) {
    if (appState.monthlyLogs && !(appState.monthlyLogs instanceof Map)) {
        const entries = Array.isArray(appState.monthlyLogs) 
            ? appState.monthlyLogs 
            : Object.entries(appState.monthlyLogs);
            
        const map = new Map<string, bigint>();
        entries.forEach((item: any) => {
            const key = Array.isArray(item) ? item[0] : item[0];
            const val = Array.isArray(item) ? item[1] : item[1];
            
            try {
                if (val && typeof val === 'object' && val.__type === 'bigint') {
                    map.set(key, BigInt(val.val));
                } else if (typeof val === 'string') {
                    const hexClean = val.startsWith('0x') ? val : '0x' + val;
                    map.set(key, BigInt(hexClean));
                } else if (typeof val === 'bigint') {
                    map.set(key, val);
                } else {
                    map.set(key, BigInt(val));
                }
            } catch(e) {
                console.warn(`[Merge] Failed to hydrate bitmask for ${key}`, e);
            }
        });
        (appState as any).monthlyLogs = map;
    }
}

/**
 * Mescla o histórico de agendamentos de um hábito.
 */
function mergeHabitHistories(localHistory: HabitSchedule[], incomingHistory: HabitSchedule[]): HabitSchedule[] {
    const historyMap = new Map<string, HabitSchedule>();
    localHistory.forEach(s => historyMap.set(s.startDate, { ...s }));
    incomingHistory.forEach(incoming => {
        const existing = historyMap.get(incoming.startDate);
        if (!existing) {
            historyMap.set(incoming.startDate, { ...incoming });
        } else {
            if (incoming.endDate && (!existing.endDate || incoming.endDate < existing.endDate)) {
                existing.endDate = incoming.endDate;
            }
            if (incoming.philosophy && !existing.philosophy) {
                (existing as any).philosophy = incoming.philosophy;
            }
        }
    });
    return Array.from(historyMap.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
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
                if ((srcInst.note?.length || 0) > (tgtInst.note?.length || 0)) {
                    tgtInst.note = srcInst.note;
                }
                if (srcInst.goalOverride !== undefined) {
                    tgtInst.goalOverride = srcInst.goalOverride;
                }
            }
        }
        if (source[habitId].dailySchedule) target[habitId].dailySchedule = source[habitId].dailySchedule;
    }
}

export async function mergeStates(local: AppState, incoming: AppState): Promise<AppState> {
    hydrateLogs(local);
    hydrateLogs(incoming);

    const localTs = local.lastModified || 0;
    const incomingTs = incoming.lastModified || 0;
    
    // PROTEÇÃO CONTRA RESET ACIDENTAL [2025-06-05]:
    // Se um lado não tem hábitos e o outro tem, o lado com hábitos é o vencedor de base,
    // a menos que o timestamp seja massivamente diferente (anos).
    let winner: AppState;
    let loser: AppState;

    if (local.habits.length === 0 && incoming.habits.length > 0) {
        winner = incoming;
        loser = local;
    } else if (incoming.habits.length === 0 && local.habits.length > 0) {
        winner = local;
        loser = incoming;
    } else {
        winner = localTs >= incomingTs ? local : incoming;
        loser = localTs >= incomingTs ? incoming : local;
    }
    
    const merged: AppState = structuredClone(winner);
    const mergedHabitsMap = new Map<string, Habit>();
    
    merged.habits.forEach(h => mergedHabitsMap.set(h.id, h));
    
    loser.habits.forEach(loserHabit => {
        const winnerHabit = mergedHabitsMap.get(loserHabit.id);
        if (!winnerHabit) {
            mergedHabitsMap.set(loserHabit.id, loserHabit);
        } else {
            winnerHabit.scheduleHistory = mergeHabitHistories(winnerHabit.scheduleHistory, loserHabit.scheduleHistory);
            
            if (loserHabit.deletedOn) {
                if (!winnerHabit.deletedOn || loserHabit.deletedOn > winnerHabit.deletedOn) {
                    winnerHabit.deletedOn = loserHabit.deletedOn;
                }
            }

            if (loserHabit.graduatedOn) {
                if (!winnerHabit.graduatedOn || loserHabit.graduatedOn < winnerHabit.graduatedOn) {
                    winnerHabit.graduatedOn = loserHabit.graduatedOn;
                }
            }
        }
    });

    (merged as any).habits = Array.from(mergedHabitsMap.values());

    for (const date in loser.dailyData) {
        if (!merged.dailyData[date]) (merged.dailyData as any)[date] = loser.dailyData[date];
        else mergeDayRecord(loser.dailyData[date], (merged.dailyData as any)[date]);
    }

    merged.monthlyLogs = HabitService.mergeLogs(winner.monthlyLogs, loser.monthlyLogs);
    
    // O timestamp final deve ser maior que os dois
    merged.lastModified = Math.max(localTs, incomingTs, Date.now()) + 1;

    return merged;
}