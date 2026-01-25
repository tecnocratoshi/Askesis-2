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
 * Lógica Robusta: Se qualquer versão indicar um encerramento (endDate), 
 * essa informação é tratada como prioritária para evitar a ressurreição de hábitos.
 */
function mergeHabitHistories(localHistory: HabitSchedule[], incomingHistory: HabitSchedule[]): HabitSchedule[] {
    const historyMap = new Map<string, HabitSchedule>();

    // Une todas as chaves de data de início para garantir que nenhum segmento seja esquecido
    localHistory.forEach(s => historyMap.set(s.startDate, { ...s }));

    incomingHistory.forEach(incoming => {
        const existing = historyMap.get(incoming.startDate);
        if (!existing) {
            // Segmento novo (vindo de outro dispositivo)
            historyMap.set(incoming.startDate, { ...incoming });
        } else {
            // Conflito no mesmo segmento: 
            // 1. Prioriza a presença de endDate (Encerramento é um estado terminal desejado)
            if (incoming.endDate && (!existing.endDate || incoming.endDate < existing.endDate)) {
                existing.endDate = incoming.endDate;
            }
            
            // 2. Se o incoming tiver propriedades mais completas (ex: filosofia), mantém
            if (incoming.philosophy && !existing.philosophy) {
                (existing as any).philosophy = incoming.philosophy;
            }
            
            // 3. Mantém o nome/ícone/cor mais recente (se houver metadados de data neles, 
            // mas aqui simplificamos para o objeto que já está no mapa que é o do "vencedor")
        }
    });

    // Ordena e remove duplicatas lógicas se necessário
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
                // Merge de notas: Mantém a nota mais longa (heurística de "mais informação")
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
    
    // O vencedor define a estrutura básica
    let winner = localTs > incomingTs ? local : incoming;
    let loser = localTs > incomingTs ? incoming : local;
    
    const merged: AppState = structuredClone(winner);
    const mergedHabitsMap = new Map<string, Habit>();
    
    // Mapeia hábitos do vencedor
    merged.habits.forEach(h => mergedHabitsMap.set(h.id, h));
    
    // Tenta mesclar detalhes dos hábitos do "perdedor"
    loser.habits.forEach(loserHabit => {
        const winnerHabit = mergedHabitsMap.get(loserHabit.id);
        if (!winnerHabit) {
            // Hábito criado em outro dispositivo e ainda não sincronizado
            mergedHabitsMap.set(loserHabit.id, loserHabit);
        } else {
            // Hábito existe em ambos: Executa Merge Profundo de Histórico
            winnerHabit.scheduleHistory = mergeHabitHistories(
                winnerHabit.scheduleHistory,
                loserHabit.scheduleHistory
            );
            
            // Reconcilia data de graduação (a mais antiga/primeira vence)
            if (loserHabit.graduatedOn) {
                if (!winnerHabit.graduatedOn || loserHabit.graduatedOn < winnerHabit.graduatedOn) {
                    winnerHabit.graduatedOn = loserHabit.graduatedOn;
                }
            }
        }
    });

    (merged as any).habits = Array.from(mergedHabitsMap.values());

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
    
    // Garante que o estado resultante tenha um timestamp superior a ambos para propagar a mesclagem
    merged.lastModified = Math.max(localTs, incomingTs, Date.now()) + 1;

    return merged;
}
