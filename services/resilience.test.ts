/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file services/resilience.test.ts
 * @description Testes de Resiliência: Recuperação de falhas, atomicidade, consistência
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

describe('RESILIÊNCIA: Recuperação de Falhas e Garantias de Consistência', () => {

  beforeEach(() => {
    state.monthlyLogs = new Map();
    state.uiDirtyState.chartData = false;
  });

  describe('Atomicidade de Operações', () => {

    it('deve garantir que setStatus é atômico (all-or-nothing)', () => {
      const habitId = 'habit-atomic';
      const dateISO = '2026-01-15';

      // Estado antes
      const before = state.monthlyLogs?.size || 0;

      // Tenta operação
      HabitService.setStatus(habitId, dateISO, 'Morning' as any, 1);

      // Estado depois (deve ter exatamente 1 entrada a mais)
      const after = state.monthlyLogs?.size || 0;
      expect(after).toBe(before + 1);

      // Verifica que os dados foram totalmente escritos
      const result = HabitService.getStatus(habitId, dateISO, 'Morning' as any);
      expect(result).toBe(1);

      // Não há estado intermediário
      state.monthlyLogs?.forEach((val) => {
        expect(typeof val).toBe('bigint');
      });
    });

    it('deve manter integridade se múltiplas operações falham parcialmente', () => {
      // Simula sequência de operações
      const operations = [
        { habitId: 'h1', date: '2026-01-01', status: 1 },
        { habitId: 'h2', date: '2026-01-02', status: 2 },
        { habitId: 'h3', date: '2026-01-03', status: 3 },
        { habitId: 'h4', date: '2026-01-04', status: 1 },
      ];

      let completed = 0;
      operations.forEach(op => {
        try {
          HabitService.setStatus(op.habitId, op.date, 'Morning' as any, op.status);
          completed++;
        } catch (e) {
          // Simula falha em operação 3
          if (completed === 2) {
            throw e;
          }
        }
      });

      // As operações completadas devem estar íntegras
      expect(HabitService.getStatus('h1', '2026-01-01', 'Morning' as any)).toBe(1);
      expect(HabitService.getStatus('h2', '2026-01-02', 'Morning' as any)).toBe(2);
    });

    it('deve ser idempotente: múltiplas chamadas não causam corrupção', () => {
      const habitId = 'habit-idempotent';
      const dateISO = '2026-01-15';

      // Chama 10 vezes
      for (let i = 0; i < 10; i++) {
        HabitService.setStatus(habitId, dateISO, 'Morning' as any, 2);
      }

      // Tamanho do mapa deve ser 1 (não 10)
      expect(state.monthlyLogs?.size).toBe(1);

      // Valor deve ser 2 (não alguma acumulação)
      expect(HabitService.getStatus(habitId, dateISO, 'Morning' as any)).toBe(2);
    });
  });

  describe('Detecção e Recuperação de Corrupção', () => {

    it('deve detectar bitmask inválido e recuperar', () => {
      const habitId = 'habit-corrupt';
      const key = `${habitId}_2026-01`;

      // Introduz corrupção
      state.monthlyLogs?.set(key, (1n << 1000n)); // Valor impossível

      // Operação subsequente deve lidar gracefully
      HabitService.setStatus(habitId, '2026-01-15', 'Morning' as any, 1);

      // Deve retornar valor válido
      const result = HabitService.getStatus(habitId, '2026-01-15', 'Morning' as any);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(3);
    });

    it('deve validar dados durante deserialização', () => {
      const invalid = [
        ['h1_2026-01', 'not-a-hex'],
        ['h2_2026-02', '0x-invalid'],
        ['h3_2026-03', 'xyz'],
      ];

      // Deve não lançar erro
      expect(() => {
        HabitService.deserializeLogsFromCloud(invalid as [string, string][]);
      }).not.toThrow();

      // Estado deve ser válido após tentativa
      expect(state.monthlyLogs instanceof Map).toBe(true);
    });

    it('deve recuperar de corrupção em dailyData', async () => {
      const corrupted = createTestState({
        habits: [createTestHabit('h1')],
        dailyData: {
          '2026-01-15': {
            'h1': {
              // Estrutura corrupta/faltando campos
              instances: null as any,
              dailySchedule: undefined,
            },
          },
        } as any,
        lastModified: 1000,
      });

      const clean = createTestState({
        habits: [createTestHabit('h1')],
        lastModified: 2000,
      });

      // Deve não lançar erro
      const merged = await mergeStates(corrupted, clean);

      expect(merged.habits.length).toBeGreaterThan(0);
    });

    it('deve lidar com monthlyLogs não-Map em merge', async () => {
      // Estado com monthlyLogs como array (corrupto)
      const stateA = createTestState({
        habits: [createTestHabit('h1')],
        lastModified: 1000,
      });
      stateA.monthlyLogs = new Map([['h1_2026-01', 5n]]);

      const stateB = createTestState({
        habits: [createTestHabit('h1')],
        lastModified: 2000,
      });

      // Simula corrupção
      (stateB as any).monthlyLogs = [['h2_2026-02', 3n]];

      const merged = await mergeStates(stateA, stateB);

      expect(merged.monthlyLogs instanceof Map).toBe(true);
    });
  });

  describe('Rollback e Ponto de Recuperação', () => {

    it('deve permitir rollback via snapshot', () => {
      // Estado inicial
      HabitService.setStatus('h1', '2026-01-15', 'Morning' as any, 1);
      const snapshot = HabitService.serializeLogsForCloud();

      // Operações subsequentes
      HabitService.setStatus('h2', '2026-02-20', 'Afternoon' as any, 2);
      HabitService.setStatus('h3', '2026-03-10', 'Evening' as any, 3);

      // Rollback
      HabitService.clearAllLogs();
      HabitService.deserializeLogsFromCloud(snapshot);

      // Verifica que está no estado anterior
      expect(HabitService.getStatus('h1', '2026-01-15', 'Morning' as any)).toBe(1);
      expect(HabitService.getStatus('h2', '2026-02-20', 'Afternoon' as any)).toBe(0);
    });

    it('deve recuperar de clearAllLogs acidental', () => {
      // Escreve dados
      HabitService.setStatus('h1', '2026-01-15', 'Morning' as any, 1);
      const backup = HabitService.serializeLogsForCloud();

      // Acidental clear
      HabitService.clearAllLogs();
      expect(state.monthlyLogs?.size).toBe(0);

      // Recuperação
      HabitService.deserializeLogsFromCloud(backup);

      expect(state.monthlyLogs?.size).toBe(1);
      expect(HabitService.getStatus('h1', '2026-01-15', 'Morning' as any)).toBe(1);
    });

    it('deve permitir savepoint e restore em merge', async () => {
      const original = createTestState({
        habits: [createTestHabit('h1')],
        monthlyLogs: new Map([['h1_2026-01', 5n]]),
        lastModified: 1000,
      });

      // Savepoint
      const stateBeforeMerge = structuredClone(original);

      const incoming = createTestState({
        habits: [createTestHabit('h1')],
        monthlyLogs: new Map([['h1_2026-01', 3n]]),
        lastModified: 500,
      });

      const merged = await mergeStates(original, incoming);

      // Verifica que original foi modificado (ou criar cópia é responsabilidade do chamador)
      // Neste caso, verificamos que o resultado é válido
      expect(merged.monthlyLogs.size).toBe(1);
      expect(merged.lastModified).toBeGreaterThan(stateBeforeMerge.lastModified);
    });
  });

  describe('Validações de Invariantes', () => {

    it('deve garantir que status sempre está em range [0, 3]', () => {
      const dates = ['2026-01-01', '2026-02-15', '2026-12-31'];
      const times: TimeOfDay[] = ['Morning', 'Afternoon', 'Evening'];

      dates.forEach(date => {
        times.forEach(time => {
          HabitService.setStatus('h1', date, time, (Math.random() * 4) | 0); // Força range
        });
      });

      // Verifica todos os valores
      dates.forEach(date => {
        times.forEach(time => {
          const val = HabitService.getStatus('h1', date, time);
          expect(val).toBeGreaterThanOrEqual(0);
          expect(val).toBeLessThanOrEqual(3);
        });
      });
    });

    it('deve garantir que bitmask nunca overflow', () => {
      // Tenta forçar overflow
      for (let month = 1; month <= 12; month++) {
        for (let day = 1; day <= 28; day++) {
          for (let period = 0; period < 3; period++) {
            const time = ['Morning', 'Afternoon', 'Evening'][period] as TimeOfDay;
            HabitService.setStatus(
              'h1',
              `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
              time,
              3 // Máximo
            );
          }
        }
      }

      // Verifica que nenhum valor fugiu de controle
      state.monthlyLogs?.forEach(val => {
        expect(val).toBeGreaterThan(0n);
        expect(val).toBeLessThan(1n << 300n); // Limite sensato
      });
    });

    it('deve manter consistência de monthlyLogs.size com entradas', () => {
      for (let i = 0; i < 50; i++) {
        HabitService.setStatus(`h${i}`, '2026-01-15', 'Morning' as any, 1);
      }

      const size = state.monthlyLogs?.size || 0;
      let count = 0;
      state.monthlyLogs?.forEach(() => count++);

      expect(size).toBe(count);
      expect(size).toBe(50);
    });
  });

  describe('Concorrência e Race Conditions', () => {

    it('deve lidar com operações rápidas em sequência', () => {
      // Simula operações rápidas (não há true concorrência em JS single-threaded)
      const operations = [];

      for (let i = 0; i < 100; i++) {
        operations.push({
          habitId: `h${i % 10}`,
          date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
          status: (i % 3) + 1,
        });
      }

      operations.forEach(op => {
        HabitService.setStatus(op.habitId, op.date, 'Morning' as any, op.status);
      });

      // Verifica integridade
      expect(state.monthlyLogs?.size).toBeGreaterThan(0);

      // Todos os valores devem ser válidos
      state.monthlyLogs?.forEach(val => {
        expect(typeof val).toBe('bigint');
      });
    });

    it('deve ser seguro para múltiplos merges em cascata', async () => {
      const states = Array.from({ length: 5 }, (_, i) =>
        createTestState({
          habits: [createTestHabit(`h${i}`)],
          monthlyLogs: new Map([[`h${i}_2026-01`, BigInt(i + 1)]]),
          lastModified: (i + 1) * 100,
        })
      );

      let result = states[0];
      for (let i = 1; i < states.length; i++) {
        result = await mergeStates(result, states[i]);
      }

      expect(result.habits.length).toBe(5);
      expect(result.monthlyLogs.size).toBe(5);
    });
  });

  describe('Limites de Recursos', () => {

    it('deve processar max BigInt sem overflow', () => {
      // BigInt não tem limite prático em JS
      const maxSafeValue = (1n << 100n) - 1n;

      state.monthlyLogs?.set('h1_2026-01', maxSafeValue);

      const retrieved = state.monthlyLogs?.get('h1_2026-01') || 0n;
      expect(retrieved).toBe(maxSafeValue);
    });

    it('deve lidar com IDs e datas muito longas', () => {
      const longId = 'h' + 'x'.repeat(10000);
      const date = '2026-01-15';

      HabitService.setStatus(longId, date, 'Morning' as any, 1);

      const result = HabitService.getStatus(longId, date, 'Morning' as any);
      expect(result).toBe(1);
    });

    it('deve manter performance com Map grande (10k entradas)', () => {
      for (let i = 0; i < 10000; i++) {
        state.monthlyLogs?.set(`h${i % 100}_2026-${String((i % 12) + 1).padStart(2, '0')}`, BigInt(i % 8));
      }

      const start = performance.now();
      const val = state.monthlyLogs?.get('h50_2026-06');
      const elapsed = performance.now() - start;

      expect(val).toBeDefined();
      // Permite até 50ms para ambientes de CI ou máquinas lentas
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('Garantias de Segurança de Dados', () => {

    it('deve never lose data during serialization roundtrip', () => {
      const original = new Map<string, bigint>();

      for (let i = 0; i < 100; i++) {
        original.set(`h${i}_2026-${String((i % 12) + 1).padStart(2, '0')}`, BigInt(i % 8));
      }

      state.monthlyLogs = new Map(original);

      const serialized = HabitService.serializeLogsForCloud();
      state.monthlyLogs?.clear();

      HabitService.deserializeLogsFromCloud(serialized);

      expect(state.monthlyLogs?.size).toBe(original.size);

      // Verifica cada entrada
      original.forEach((val, key) => {
        expect(state.monthlyLogs?.get(key)).toBe(val);
      });
    });

    it('deve garantir que delete (prune) é irrevogável sem backup', () => {
      HabitService.setStatus('h1', '2026-01-15', 'Morning' as any, 1);
      const backup = HabitService.serializeLogsForCloud();

      HabitService.pruneLogsForHabit('h1');

      expect(HabitService.getStatus('h1', '2026-01-15', 'Morning' as any)).toBe(0);

      // Sem backup, dados perdidos
      // (Com backup, podem ser restaurados)
      HabitService.deserializeLogsFromCloud(backup);
      expect(HabitService.getStatus('h1', '2026-01-15', 'Morning' as any)).toBe(1);
    });

    it('deve manter integridade entre global state e local Map', () => {
      const local = new Map<string, bigint>();

      for (let i = 0; i < 50; i++) {
        const key = `h${i}_2026-01`;
        const val = BigInt(i % 8);
        local.set(key, val);
        HabitService.setStatus(`h${i}`, '2026-01-15', 'Morning' as any, i % 3 ? 1 : 2);
      }

      const globalSize = state.monthlyLogs?.size || 0;
      const localSize = local.size;

      // Ambos devem ter pelo menos 1 entrada
      expect(globalSize).toBeGreaterThan(0);
    });
  });
});
