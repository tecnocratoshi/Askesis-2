
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { state, PERIOD_OFFSET, TimeOfDay } from '../state';

export class HabitService {

    private static getLogKey(habitId: string, dateISO: string): string {
        return `${habitId}_${dateISO.substring(0, 7)}`; // ID_YYYY-MM
    }

    /**
     * Leitura Otimizada (Bitmask Only)
     */
    static getStatus(habitId: string, dateISO: string, time: TimeOfDay): number {
        const key = this.getLogKey(habitId, dateISO);
        const log = state.monthlyLogs?.get(key);
        
        if (log !== undefined) {
            const day = parseInt(dateISO.substring(8, 10), 10);
            const bitPos = BigInt(((day - 1) * 6) + PERIOD_OFFSET[time]);
            return Number((log >> bitPos) & 3n);
        }
        return 0;
    }

    /**
     * [CRÍTICO] Escrita Otimizada (Bitmask Only)
     * Esta função grava o clique na memória.
     */
    static setStatus(habitId: string, dateISO: string, time: TimeOfDay, newState: number) {
        if (!state.monthlyLogs) state.monthlyLogs = new Map();

        const key = this.getLogKey(habitId, dateISO);
        const day = parseInt(dateISO.substring(8, 10), 10);
        
        const bitPos = BigInt(((day - 1) * 6) + PERIOD_OFFSET[time]);
        const clearMask = ~(3n << bitPos); 
        
        let currentLog = state.monthlyLogs.get(key) || 0n;
        const newLog = (currentLog & clearMask) | (BigInt(newState) << bitPos);
        
        state.monthlyLogs.set(key, newLog);
        state.uiDirtyState.chartData = true;
    }

    /**
     * Serialização para JSON (Exportação/Cloud)
     */
    static serializeLogsForCloud(): [string, string][] {
        if (!state.monthlyLogs) return [];
        return Array.from(state.monthlyLogs.entries()).map(([key, val]) => {
            return [key, "0x" + val.toString(16)] as [string, string];
        });
    }

    /**
     * Deserialização (Importação/Cloud)
     */
    static deserializeLogsFromCloud(serialized: [string, string][]) {
        if (!Array.isArray(serialized)) return;
        const map = new Map<string, bigint>();
        serialized.forEach(([key, hexVal]) => {
            try {
                const hexClean = hexVal.startsWith("0x") ? hexVal : "0x" + hexVal;
                map.set(key, BigInt(hexClean));
            } catch (e) {
                console.warn(`[HabitService] Skipping invalid hex log: ${key}`, e);
            }
        });
        state.monthlyLogs = map;
    }
    
    /**
     * Suporte Legado (Migração de ArrayBuffer antigo)
     */
    static unpackBinaryLogs(binaryMap: Map<string, ArrayBuffer>) {
        if (!state.monthlyLogs) state.monthlyLogs = new Map();
        binaryMap.forEach((buffer, key) => {
            try {
                const view = new DataView(buffer);
                if (buffer.byteLength >= 8) {
                    state.monthlyLogs!.set(key, view.getBigUint64(0, true));
                }
            } catch (e) {
                console.warn("Falha na migração binária legada", e);
            }
        });
    }

    /**
     * INTELLIGENT MERGE (CRDT-Lite para Bitmasks)
     * Funde dois mapas de logs usando bitwise OR para acumular estados de conclusão.
     */
    static mergeLogs(winnerMap: Map<string, bigint> | undefined, loserMap: Map<string, bigint> | undefined): Map<string, bigint> {
        const result = new Map<string, bigint>(winnerMap || []);
        if (!loserMap) return result;

        for (const [key, loserVal] of loserMap.entries()) {
            const winnerVal = result.get(key) || 0n;
            result.set(key, winnerVal | loserVal);
        }
        return result;
    }
}