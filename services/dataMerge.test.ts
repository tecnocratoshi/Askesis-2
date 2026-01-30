import { describe, it, expect, beforeEach } from 'vitest';
import { mergeStates } from './dataMerge';
import { AppState, HABIT_STATE } from '../state';
import { HabitService } from './HabitService';

// Helper para criar estados falsos
const createMockState = (ts: number, logs = new Map()): AppState => ({
    version: 9,
    lastModified: ts,
    habits: [],
    dailyData: {},
    archives: {},
    dailyDiagnoses: {},
    notificationsShown: [],
    pending21DayHabitIds: [],
    pendingConsolidationHabitIds: [],
    hasOnboarded: true,
    syncLogs: [],
    monthlyLogs: logs
} as unknown as AppState);

describe('Smart Merge (CRDT-lite Logic)', () => {

    it('deve preferir o estado com timestamp mais recente (LWW Global)', async () => {
        const localState = createMockState(1000);
        const remoteState = createMockState(2000); // Remoto é mais novo

        const merged = await mergeStates(localState, remoteState);
        
        // O timestamp resultante deve ser maior que ambos (incremento lógico)
        expect(merged.lastModified).toBeGreaterThan(2000);
    });

    it('deve mesclar logs binários sem perder dados (Union)', async () => {
        // Cenário:
        // Local: Dia 1 = DONE
        // Remoto: Dia 2 = SNOOZED
        // Merge: Deve conter AMBOS
        
        const hId = 'test-habit';
        const monthKey = `${hId}_2024-01`;

        // Simula escrita Local
        const localLogs = new Map();
        // Dia 1 (Morning) = DONE (Bits: ...001)
        // Isso requer conhecimento da estrutura interna ou usar o setter público num mock.
        // Vamos forçar valores simulados para testar a lógica pura de mergeLogs.
        
        // Bitmask simulado: Dia 1 bit 0 setado
        localLogs.set(monthKey, 1n); 

        // Simula escrita Remota
        const remoteLogs = new Map();
        // Bitmask simulado: Dia 2 bit 9 setado (1 << 9 = 512)
        remoteLogs.set(monthKey, 512n);

        // Executa merge manual (acesso à função estática do HabitService)
        const mergedLogs = HabitService.mergeLogs(localLogs, remoteLogs);
        
        const result = mergedLogs.get(monthKey)!;
        
        // Deve ter o bit 0 E o bit 9 ativos
        expect((result & 1n) === 1n).toBe(true);
        expect((result & 512n) === 512n).toBe(true);
    });

    it('deve priorizar Tombstone sobre dados (Delete vence Update)', async () => {
        // Cenário CRDT Clássico:
        // Usuário A marca como FEITO.
        // Usuário B marca como APAGADO (Tombstone).
        // Resultado deve ser APAGADO.

        const key = 'h1_2024-01';
        
        // Local: Status DONE (Binário 001)
        const localLogs = new Map([[key, 1n]]); 
        
        // Remoto: Tombstone (Binário 100 -> Decimal 4)
        const remoteLogs = new Map([[key, 4n]]);

        const mergedLogs = HabitService.mergeLogs(localLogs, remoteLogs);
        const result = mergedLogs.get(key)!;

        // O resultado deve ser 4 (Tombstone), não 5 (Merge)
        // A lógica do mergeLogs verifica se o bit 2 (Tombstone) está ativo em QUALQUER um dos lados.
        expect(result).toBe(4n);
    });
});