/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file services/HabitService.ts
 * @description Motor de Operações Binárias para Logs de Hábitos (Esquema 9-bit / Tombstone).
 */

import { state, PERIOD_OFFSET, TimeOfDay } from '../state';

export class HabitService {

    private static getLogKey(habitId: string, dateISO: string): string {
        return `${habitId}_${dateISO.substring(0, 7)}`; // ID_YYYY-MM
    }

    /**
     * Valida se um valor BigInt é um log de bitmask válido para um mês.
     */
    static isValidLog(val: any): val is bigint {
        return typeof val === 'bigint';
    }

    /**
     * Leitura Otimizada com lógica de Lápide (Tombstone).
     * Se o bit de lápide (bit 2 do bloco de 3) for 1, o status é forçado para NULL (0).
     */
    static getStatus(habitId: string, dateISO: string, time: TimeOfDay): number {
        const key = this.getLogKey(habitId, dateISO);
        const log = state.monthlyLogs?.get(key);
        
        if (log !== undefined) {
            const day = parseInt(dateISO.substring(8, 10), 10);
            const bitPos = BigInt(((day - 1) * 9) + PERIOD_OFFSET[time]);
            const block = (log >> bitPos) & 7n; // Lê o bloco de 3 bits
            
            // Verifica bit de Lápide (Exclusão)
            if ((block >> 2n) & 1n) return 0; 
            
            return Number(block & 3n); // Retorna os 2 bits de status
        }
        return 0;
    }

    /**
     * Escrita Otimizada. 
     * Ao definir como NULL (0), ativa o bit de Lápide para propagar a exclusão.
     */
    static setStatus(habitId: string, dateISO: string, time: TimeOfDay, newState: number) {
        if (!state.monthlyLogs) state.monthlyLogs = new Map();

        const key = this.getLogKey(habitId, dateISO);
        const day = parseInt(dateISO.substring(8, 10), 10);
        
        const bitPos = BigInt(((day - 1) * 9) + PERIOD_OFFSET[time]);
        const clearMask = ~(7n << bitPos); // Máscara para limpar 3 bits
        
        let currentLog = state.monthlyLogs.get(key) || 0n;
        
        let valToStore = 0n;
        if (newState === 0) {
            // Caso especial: Exclusão manual (Undo)
            // Define Tombstone=1 e Status=00 -> Binário 100 -> Decimal 4
            valToStore = 4n; 
        } else {
            // Registro normal: Tombstone=0 e Status=newState
            valToStore = BigInt(newState);
        }
        
        const newLog = (currentLog & clearMask) | (valToStore << bitPos);
        
        state.monthlyLogs.set(key, newLog);
        state.uiDirtyState.chartData = true;
    }

    /**
     * EXPURGO PROFUNDO (Hard Delete).
     * Remove fisicamente todas as entradas de log associadas a um ID de hábito.
     * Isso libera memória e garante que "Apagar" realmente signifique apagar o histórico.
     */
    static pruneLogsForHabit(habitId: string) {
        if (!state.monthlyLogs) return;
        
        // As chaves são compostas por "ID_ANO-MES".
        // Podemos iterar e deletar tudo que começa com o ID.
        for (const key of state.monthlyLogs.keys()) {
            if (key.startsWith(habitId + '_')) {
                state.monthlyLogs.delete(key);
            }
        }
        state.uiDirtyState.chartData = true;
    }

    /**
     * Agrupa logs por mês para criação de shards granulares.
     */
    static getLogsGroupedByMonth(): Record<string, [string, string][]> {
        const groups: Record<string, [string, string][]> = {};
        if (!state.monthlyLogs) return groups;

        for (const [key, val] of state.monthlyLogs.entries()) {
            const month = key.split('_').pop() || 'unknown';
            if (!groups[month]) groups[month] = [];
            groups[month].push([key, "0x" + val.toString(16)]);
        }
        return groups;
    }

    /**
     * Serialização para Cloud (Hexadecimal).
     */
    static serializeLogsForCloud(): [string, string][] {
        if (!state.monthlyLogs) return [];
        return Array.from(state.monthlyLogs.entries()).map(([key, val]) => {
            return [key, "0x" + val.toString(16)] as [string, string];
        });
    }

    /**
     * Deserialização.
     */
    static deserializeLogsFromCloud(serialized: [string, string][]) {
        if (!Array.isArray(serialized)) return;
        serialized.forEach(([key, hexVal]) => {
            try {
                const hexClean = hexVal.startsWith("0x") ? hexVal : "0x" + hexVal;
                state.monthlyLogs.set(key, BigInt(hexClean));
            } catch (e) {
                console.warn(`[HabitService] Skipping invalid hex log: ${key}`);
            }
        });
    }
    
    /**
     * INTELLIGENT MERGE (CRDT-Lite para Bitmasks).
     * Itera bloco por bloco (93 blocos por mês).
     * Lógica de Resolução de Conflitos:
     * 1. Se um lado tem Tombstone (4n), ele vence (Delete Wins).
     * 2. Se ambos têm dados, a União (OR) preserva o bit de maior valor (ex: Done+ > Done).
     * 3. Se apenas um tem dados, ele vence.
     */
    static mergeLogs(winnerMap: Map<string, bigint> | undefined, loserMap: Map<string, bigint> | undefined): Map<string, bigint> {
        const result = new Map<string, bigint>(winnerMap || []);
        if (!loserMap) return result;

        for (const [key, loserVal] of loserMap.entries()) {
            const winnerVal = result.get(key) || 0n;
            let mergedVal = 0n;

            // 31 dias * 3 períodos = 93 blocos de 3 bits
            for (let i = 0n; i < 93n; i++) {
                const shift = i * 3n;
                const winnerBlock = (winnerVal >> shift) & 7n;
                const loserBlock = (loserVal >> shift) & 7n;

                let finalBlock = 0n;

                // CRDT LOGIC: Tombstone Priority > Data Priority > Empty
                const winnerTomb = (winnerBlock & 4n) === 4n;
                const loserTomb = (loserBlock & 4n) === 4n;

                if (winnerTomb || loserTomb) {
                    // Se qualquer um dos lados diz "Delete", respeitamos a deleção.
                    finalBlock = 4n; 
                } else if (winnerBlock !== 0n && loserBlock !== 0n) {
                    // Conflito de Valores Positivos: União Bitwise para preservar o estado mais "alto"
                    // Ex: Done (1) | Done+ (3) = Done+ (3)
                    finalBlock = winnerBlock | loserBlock;
                } else {
                    // Um dos lados é vazio, pegamos o que tem dados
                    finalBlock = winnerBlock | loserBlock;
                }

                mergedVal |= (finalBlock << shift);
            }
            result.set(key, mergedVal);
        }
        return result;
    }

    static clearAllLogs() {
        state.monthlyLogs = new Map();
        state.uiDirtyState.chartData = true;
    }
}