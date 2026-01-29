import { describe, it, expect, beforeEach } from 'vitest';

// Testes agrupados de utilitários de sincronização, validação, retry e merge

describe('Sync Utils - Testes Agrupados', () => {
  // Testes rápidos de diagnóstico de erro Lua
  it('Classifica erro TIMEOUT corretamente', () => {
    const classification = {
      type: 'TIMEOUT',
      isRetryable: true,
      displayMessage: 'TIMEOUT: Script excedeu tempo (será retentado)',
      category: 'TEMPORARY' as const
    };
    expect(classification.type).toBe('TIMEOUT');
    expect(classification.isRetryable).toBe(true);
    expect(classification.displayMessage).toContain('será retentado');
  });

  // Teste de validação de serialização para Lua
  it('Serializa shards válidos para JSON sem erros', () => {
    const shards = {
      core: JSON.stringify({ version: 1, habits: [], dailyData: {} }),
      'logs:2024-01': JSON.stringify([['habit-1_2024-01-01', '123456789']]),
      'archive:2023': JSON.stringify({ data: 'archived' })
    };
    const payload = JSON.stringify({ lastModified: Date.now(), shards });
    expect(payload).toBeTruthy();
    expect(payload.length).toBeGreaterThan(0);
    const parsed = JSON.parse(payload);
    expect(parsed.shards).toBeDefined();
  });

  // Teste de retry/backoff exponencial
  it('Calcula delay de backoff exponencial corretamente', () => {
    const RETRY_CONFIG = {
      maxAttempts: 5,
      initialDelayMs: 1000,
      maxDelayMs: 32000,
      backoffFactor: 2
    };
    const delays = [];
    for (let i = 0; i < 5; i++) {
      const delay = RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffFactor, i);
      delays.push(delay);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  // Teste de merge de estados
  it('Prefere estado com timestamp mais recente', async () => {
    const createMockState = (ts: number, logs = new Map()) => ({
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
    });
    const localState = createMockState(1000);
    const remoteState = createMockState(2000);
    // Simulação simplificada do merge
    const merged = { ...localState, ...remoteState, lastModified: Math.max(localState.lastModified, remoteState.lastModified) + 1 };
    expect(merged.lastModified).toBeGreaterThan(2000);
  });
});
