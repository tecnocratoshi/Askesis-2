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
 * Mescla o histórico de agendamentos de um hábito específico.
 * Lógica: Prioriza entradas que possuem endDate (intenção de encerramento) 
 * ou a versão mais completa de cada fatia temporal.
 */
function mergeHabitHistories(localHistory: HabitSchedule[], incomingHistory: HabitSchedule[]): HabitSchedule[] {
    const historyMap = new Map<string, HabitSchedule>();

    // Adiciona histórico local ao mapa
    localHistory.forEach(s => historyMap.set(s.startDate, { ...s }));

    // Mescla com o histórico recebido
    incomingHistory.forEach(incoming => {
        const existing = historyMap.get(incoming.startDate);
        if (!existing) {
            historyMap.set(incoming.startDate, { ...incoming });
        } else {
            // CONFLICT RESOLUTION: Se o incoming tem um endDate e o local não,
            // ou se o incoming foi modificado mais recentemente (implícito pelo fluxo).
            // Damos peso maior para a presença de endDate, pois encerrar é uma ação de alto nível.
            if (incoming.endDate && !existing.endDate) {
                existing.endDate = incoming.endDate;
            }
            
            // Mescla outros campos se necessário (cores, ícones, metas)
            // Aqui poderíamos adicionar lógica de timestamp por shard se necessário,
            // mas o endDate é o critério crítico solicitado.
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
    
    let winner = localTs > incomingTs ? local : incoming;
    let loser = localTs > incomingTs ? incoming : local;
    
    const merged: AppState = structuredClone(winner);
    
    // 1. RECONCILIAÇÃO PROFUNDA DE HÁBITOS
    const mergedHabits = new Map<string, Habit>();
    
    // Mapeia vencedores
    merged.habits.forEach(h => mergedHabits.set(h.id, h));
    
    // Verifica perdedores para merges parciais
    loser.habits.forEach(loserHabit => {
        const winnerHabit = mergedHabits.get(loserHabit.id);
        if (!winnerHabit) {
            // Hábito novo no perdedor (criado offline)
            mergedHabits.set(loserHabit.id, loserHabit);
        } else {
            // Hábito existe em ambos. Faz merge do scheduleHistory.
            winnerHabit.scheduleHistory = mergeHabitHistories(
                winnerHabit.scheduleHistory,
                loserHabit.scheduleHistory
            );
            
            // Sincroniza flags de formatura (graduatedOn)
            if (loserHabit.graduatedOn && (!winnerHabit.graduatedOn || loserHabit.graduatedOn < winnerHabit.graduatedOn)) {
                winnerHabit.graduatedOn = loserHabit.graduatedOn;
            }
        }
    });

    (merged as any).habits = Array.from(mergedHabits.values());

    // 2. Mesclagem de Dados Diários (Notas/Overrides)
    for (const date in loser.dailyData) {
        if (!merged.dailyData[date]) {
            (merged.dailyData as any)[date] = loser.dailyData[date];
        } else {
            mergeDayRecord(loser.dailyData[date], (merged.dailyData as any)[date]);
        }
    }

    // 3. Mesclagem de Logs de Status (Bitmasks)
    merged.monthlyLogs = HabitService.mergeLogs(winner.monthlyLogs, loser.monthlyLogs);
    
    merged.lastModified = Math.max(localTs, incomingTs, Date.now()) + 1;

    return merged;
}
