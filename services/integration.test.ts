/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file services/integration.test.ts
 * @description Testes de Integração: HabitService + dataMerge + Multi-cliente
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HabitService } from './HabitService';
import { mergeStates } from './dataMerge';
import { state, AppState, Habit, TimeOfDay } from '../state';

function createTestState(overrides?: Partial<AppState>): AppState {
  return {
    version: 9,
    habits: [],
    dailyData: {},
    monthlyLogs: new Map(),
    lastModified: Date.now(),
    notificationsShown: [],
    pending21DayHabitIds: [],
    pendingConsolidationHabitIds: [],
    syncLogs: [],
    archives: {},
    dailyDiagnoses: {},
    hasOnboarded: false,
    ...overrides,
  };
}

function createTestHabit(id: string, overrides?: Partial<Habit>): Habit {
  return {
    id,
    createdOn: '2026-01-01',
    scheduleHistory: [
      {
        startDate: '2026-01-01',
        endDate: undefined,
        name: `Test Habit ${id}`,
        icon: '📋',
        color: '#3498DB',
        goal: { type: 'check' },
        frequency: { type: 'daily' },
        times: ['Morning'] as readonly TimeOfDay[],
        scheduleAnchor: '2026-01-01',
        philosophy: {
          sphere: 'Mental',
          level: 1,
          virtue: 'Wisdom',
          discipline: 'Desire',
          nature: 'Addition',
          conscienceKey: 'test-key',
          stoicConcept: 'test-concept',
          masterQuoteId: 'test-quote',
        },
      },
    ],
    ...overrides,
  };
}

describe('INTEGRAÇÃO: HabitService + dataMerge (End-to-End)', () => {

  beforeEach(() => {
    state.monthlyLogs = new Map();
    state.uiDirtyState.chartData = false;
  });

  describe('Fluxo Completo: Escrita → Serialização → Merge → Leitura', () => {

    it('deve preservar dados após ciclo completo de operações', async () => {
      // 1. Escreve dados localmente via HabitService
      HabitService.setStatus('habit-1', '2026-01-15', 'Morning' as any, 1);
      HabitService.setStatus('habit-1', '2026-01-15', 'Afternoon' as any, 2);
      HabitService.setStatus('habit-2', '2026-02-20', 'Evening' as any, 3);

      // 2. Serializa (simula envio para nuvem)
      const serialized = HabitService.serializeLogsForCloud();

      // 3. Simula sincronização: cria dois estados e mescla
      const localState = createTestState({
        habits: [createTestHabit('habit-1'), createTestHabit('habit-2')],
        monthlyLogs: new Map(state.monthlyLogs),
        lastModified: Date.now(),
      });

      const remoteState = createTestState({
        habits: [createTestHabit('habit-1'), createTestHabit('habit-2')],
        monthlyLogs: new Map(),
        lastModified: Date.now() - 1000,
      });

      // Deserializa no remoto e faz merge
      HabitService.deserializeLogsFromCloud(serialized);
      remoteState.monthlyLogs = new Map(state.monthlyLogs);

      const merged = await mergeStates(localState, remoteState);

      // 4. Restaura estado global e verifica
      state.monthlyLogs = merged.monthlyLogs;

      expect(HabitService.getStatus('habit-1', '2026-01-15', 'Morning' as any)).toBe(1);
      expect(HabitService.getStatus('habit-1', '2026-01-15', 'Afternoon' as any)).toBe(2);
      expect(HabitService.getStatus('habit-2', '2026-02-20', 'Evening' as any)).toBe(3);
    });

    it('deve sincronizar dados entre 3 clientes sem perda', async () => {
      // Simula 3 clientes com estados diferentes
      const clientA = createTestState({
        habits: [createTestHabit('h1')],
        lastModified: 1000,
      });
      const clientB = createTestState({
        habits: [createTestHabit('h1')],
        lastModified: 2000,
      });
      const clientC = createTestState({
        habits: [createTestHabit('h1')],
        lastModified: 1500,
      });

      // HabitService escreve em cada cliente
      const states = [clientA, clientB, clientC];
      states.forEach((s, i) => {
        s.monthlyLogs = new Map();
        s.monthlyLogs.set(`h1_2026-0${i + 1}`, BigInt(i + 1));
      });

      // Sincroniza em cascata: A → B, depois B → C
      const syncedAB = await mergeStates(clientA, clientB);
      const finalState = await mergeStates(syncedAB, clientC);

      expect(finalState.monthlyLogs.size).toBe(3);
    });
  });

  describe('Cenários Multi-Cliente Realistas', () => {

    it('deve resolver conflito de edição simultânea no mesmo hábito', async () => {
      // Cliente A modifica um hábito
      const clientA = createTestState({
        habits: [createTestHabit('h1')],
        lastModified: 1000,
      });

      // Cliente B modifica o mesmo hábito de forma diferente
      const clientB = createTestState({
        habits: [createTestHabit('h1')],
        lastModified: 2000, // B é mais recente
      });

      const merged = await mergeStates(clientA, clientB);

      // B vence por ser mais recente
      expect(merged.habits[0].scheduleHistory[0].name).toBe('Test Habit h1');
    });

    it('deve manter consistência ao adicionar/deletar hábitos em paralelo', async () => {
      const clientA = createTestState({
        habits: [createTestHabit('h1'), createTestHabit('h2')],
        lastModified: 1000,
      });

      const clientB = createTestState({
        habits: [
          createTestHabit('h1'),
          createTestHabit('h2', { deletedOn: '2026-01-15' }),
          createTestHabit('h3'),
        ],
        lastModified: 1000,
      });

      const merged = await mergeStates(clientA, clientB);

      expect(merged.habits.length).toBe(3);
      expect(merged.habits.some(h => h.id === 'h3')).toBe(true);
      expect(merged.habits.find(h => h.id === 'h2')?.deletedOn).toBe('2026-01-15');
    });

    it('deve sincronizar progresso parcial entre clientes', async () => {
      // Cliente A completa alguns dias
      const clientA = createTestState({
        habits: [createTestHabit('h1')],
        monthlyLogs: new Map([
          ['h1_2026-01', (1n << 0n) | (1n << 3n)], // 2 entradas
        ]),
        lastModified: 1000,
      });

      // Cliente B completa outros dias
      const clientB = createTestState({
        habits: [createTestHabit('h1')],
        monthlyLogs: new Map([
          ['h1_2026-01', (1n << 6n)], // Dia diferente
        ]),
        lastModified: 1000,
      });

      const merged = await mergeStates(clientA, clientB);

      // Deve fazer OR dos bits
      const result = merged.monthlyLogs.get('h1_2026-01') || 0n;
      expect((result & (1n << 0n))).toBeGreaterThan(0n);
      expect((result & (1n << 3n))).toBeGreaterThan(0n);
      expect((result & (1n << 6n))).toBeGreaterThan(0n);
    });
  });

  describe('Recuperação de Falhas e Corrupção', () => {

    it('deve recuperar de bitmask parcialmente corrompido', async () => {
      // Estado "corrompido" (valores extremos)
      const corrupted = createTestState({
        habits: [createTestHabit('h1')],
        monthlyLogs: new Map([
          ['h1_2026-01', (1n << 100n)], // Valor muito grande
        ]),
        lastModified: 1000,
      });

      const clean = createTestState({
        habits: [createTestHabit('h1')],
        monthlyLogs: new Map([
          ['h1_2026-01', 3n], // Valor válido
        ]),
        lastModified: 2000, // Mais recente
      });

      const merged = await mergeStates(corrupted, clean);

      expect(merged.monthlyLogs.size).toBe(1);
      const val = merged.monthlyLogs.get('h1_2026-01') || 0n;
      expect(val).toBeLessThan(1n << 120n); // Validação mínima
    });

    it('deve manter dados intactos durante merge com estado parcial', async () => {
      const complete = createTestState({
        habits: [createTestHabit('h1'), createTestHabit('h2')],
        dailyData: {
          '2026-01-15': {
            'h1': {
              instances: { 'Morning': { note: 'Complete' } },
              dailySchedule: undefined,
            },
          },
        },
        monthlyLogs: new Map([['h1_2026-01', 5n]]),
        lastModified: 2000,
      });

      const partial = createTestState({
        habits: [createTestHabit('h1')], // Faltam h2
        dailyData: {},
        monthlyLogs: new Map(),
        lastModified: 1000,
      });

      const merged = await mergeStates(complete, partial);

      expect(merged.habits.length).toBe(2);
      expect(Object.keys(merged.dailyData).length).toBe(1);
      expect(merged.monthlyLogs.size).toBe(1);
    });

    it('deve lidar com missing dailyData para hábitos existentes', async () => {
      const state1 = createTestState({
        habits: [createTestHabit('h1')],
        dailyData: {
          '2026-01-15': {
            'h1': {
              instances: { 'Morning': { note: 'Day 1' } },
              dailySchedule: undefined,
            },
          },
        },
        lastModified: 1000,
      });

      const state2 = createTestState({
        habits: [createTestHabit('h1')],
        dailyData: {}, // Sem dados diários
        lastModified: 2000,
      });

      const merged = await mergeStates(state1, state2);

      expect(merged.dailyData['2026-01-15']).toBeDefined();
    });
  });

  describe('Operações em Massa via HabitService', () => {

    it('deve processar 100 operações setStatus sem perda de dados', () => {
      const operations = [];

      for (let i = 0; i < 100; i++) {
        const habitId = `habit-${i % 10}`;
        const day = (i % 28) + 1;
        const period = ['Morning', 'Afternoon', 'Evening'][i % 3] as TimeOfDay;
        const status = (i % 3) + 1;

        operations.push({
          habitId,
          date: `2026-01-${String(day).padStart(2, '0')}`,
          period,
          status,
        });
      }

      // Executa todas as operações
      operations.forEach(op => {
        HabitService.setStatus(op.habitId, op.date, op.period, op.status);
      });

      // Verifica integridade de algumas operações
      expect(HabitService.getStatus('habit-0', '2026-01-01', 'Morning' as any)).toBeGreaterThan(0);
      expect(state.monthlyLogs?.size).toBeGreaterThan(0);
    });

    it('deve manter integridade após prune + rewrite', () => {
      // Escreve dados
      HabitService.setStatus('habit-1', '2026-01-15', 'Morning' as any, 1);
      HabitService.setStatus('habit-2', '2026-01-15', 'Morning' as any, 2);

      const beforePrune = state.monthlyLogs?.size || 0;

      // Deleta um hábito
      HabitService.pruneLogsForHabit('habit-1');

      expect(state.monthlyLogs?.size).toBeLessThan(beforePrune);

      // Reescreve dados diferentes
      HabitService.setStatus('habit-3', '2026-02-20', 'Afternoon' as any, 3);

      // Verifica que dados anteriores estão lá
      expect(HabitService.getStatus('habit-2', '2026-01-15', 'Morning' as any)).toBe(2);
      expect(HabitService.getStatus('habit-3', '2026-02-20', 'Afternoon' as any)).toBe(3);
    });
  });

  describe('Serialização em Integração com Merge', () => {

    it('deve round-trip completo: serialize → deserialize → merge → verify', () => {
      // Fase 1: Escreve dados
      HabitService.setStatus('h1', '2026-01-01', 'Morning' as any, 1);
      HabitService.setStatus('h2', '2026-02-15', 'Afternoon' as any, 2);

      // Fase 2: Serializa (simula backup)
      const backup = HabitService.serializeLogsForCloud();

      // Fase 3: Limpa estado
      HabitService.clearAllLogs();
      expect(state.monthlyLogs?.size).toBe(0);

      // Fase 4: Cria novo estado com dados diferentes
      HabitService.setStatus('h3', '2026-03-10', 'Evening' as any, 3);

      // Fase 5: Deserializa backup
      HabitService.deserializeLogsFromCloud(backup);

      // Fase 6: Verifica que ambos estão presentes
      expect(HabitService.getStatus('h1', '2026-01-01', 'Morning' as any)).toBe(1);
      expect(HabitService.getStatus('h2', '2026-02-15', 'Afternoon' as any)).toBe(2);
      expect(HabitService.getStatus('h3', '2026-03-10', 'Evening' as any)).toBe(3);
    });

    it('deve mesclar múltiplos backups sem perda', async () => {
      // Cria 3 versões de dados
      const version1 = createTestState({ lastModified: 1000 });
      const version2 = createTestState({ lastModified: 2000 });
      const version3 = createTestState({ lastModified: 3000 });

      // Popula com dados diferentes
      version1.monthlyLogs.set('h1_2026-01', 1n);
      version2.monthlyLogs.set('h2_2026-02', 2n);
      version3.monthlyLogs.set('h3_2026-03', 3n);

      // Faz merge sequencial
      let merged = await mergeStates(version1, version2);
      merged = await mergeStates(merged, version3);

      expect(merged.monthlyLogs.size).toBe(3);
      expect(merged.monthlyLogs.get('h1_2026-01')).toBe(1n);
      expect(merged.monthlyLogs.get('h2_2026-02')).toBe(2n);
      expect(merged.monthlyLogs.get('h3_2026-03')).toBe(3n);
    });
  });

  describe('Consistent hashing & Sharding', () => {

    it('deve agrupar logs logicamente por mês após múltiplas operações', () => {
      // Escreve dados em múltiplos meses
      for (let month = 1; month <= 12; month++) {
        HabitService.setStatus(
          'habit-1',
          `2026-${String(month).padStart(2, '0')}-15`,
          'Morning' as any,
          month % 3 ? 1 : 2
        );
      }

      const grouped = HabitService.getLogsGroupedByMonth();

      expect(Object.keys(grouped).length).toBe(12);
      Object.values(grouped).forEach(group => {
        expect(group.length).toBeGreaterThan(0);
      });
    });

    it('deve manter shards consistentes após merge', async () => {
      // Cliente A: dados de Jan-Apr
      const clientA = createTestState({ lastModified: 1000 });
      for (let m = 1; m <= 4; m++) {
        clientA.monthlyLogs.set(`h1_2026-${String(m).padStart(2, '0')}`, BigInt(m));
      }

      // Cliente B: dados de May-Dec
      const clientB = createTestState({ lastModified: 2000 });
      for (let m = 5; m <= 12; m++) {
        clientB.monthlyLogs.set(`h1_2026-${String(m).padStart(2, '0')}`, BigInt(m));
      }

      const merged = await mergeStates(clientA, clientB);

      expect(merged.monthlyLogs.size).toBe(12);

      // Simula agrpuar após merge
      state.monthlyLogs = merged.monthlyLogs;
      const grouped = HabitService.getLogsGroupedByMonth();

      expect(Object.keys(grouped).length).toBe(12);
    });
  });
});
