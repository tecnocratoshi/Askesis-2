/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file health.ts
 * @description Endpoint de health check para monitoramento de produção.
 * Retorna status da aplicação, sincronização e saúde dos caches.
 */

import { state } from '../state';
import { logger } from './logger';

export type SyncStatus = 'idle' | 'in-progress' | 'failed' | 'success';

export interface CacheHealth {
  name: string;
  size: number;
  estimatedMemoryBytes: number;
  estimatedMemoryMB: number;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
  appVersion: string;
  syncStatus: SyncStatus;
  caches: CacheHealth[];
  totalCacheMemoryMB: number;
  errors?: string[];
}

// Rastreamento de erros e status
let lastSyncStatus: SyncStatus = 'idle';
let lastSyncError: string | null = null;
let appStartTime = Date.now();

/**
 * Atualiza o status de sincronização (chamado por sync.ts)
 */
export function setSyncStatus(status: SyncStatus, error?: string): void {
  lastSyncStatus = status;
  if (error) {
    lastSyncError = error;
    logger.warn('Sync error', { module: 'health' }, error);
  } else {
    lastSyncError = null;
  }
}

/**
 * Calcula tamanho estimado de um Map em bytes
 * (Heurística: cada entrada = 150 bytes em média)
 */
function estimateMapMemory(map: Map<any, any>): number {
  return map.size * 150;
}

/**
 * Obtém informações de saúde dos caches
 */
function getCachesHealth(): { caches: CacheHealth[]; total: number } {
  const cacheEntries = [
    {
      name: 'streaksCache',
      map: state.streaksCache,
      bytesPerEntry: 128,
    },
    {
      name: 'habitAppearanceCache',
      map: state.habitAppearanceCache,
      bytesPerEntry: 256,
    },
    {
      name: 'scheduleCache',
      map: state.scheduleCache,
      bytesPerEntry: 200,
    },
    {
      name: 'activeHabitsCache',
      map: state.activeHabitsCache,
      bytesPerEntry: 180,
    },
    {
      name: 'daySummaryCache',
      map: state.daySummaryCache,
      bytesPerEntry: 300,
    },
    {
      name: 'unarchivedCache',
      map: state.unarchivedCache,
      bytesPerEntry: 150,
    },
  ];

  const caches: CacheHealth[] = cacheEntries.map(entry => {
    const estimatedBytes = entry.map.size * entry.bytesPerEntry;
    return {
      name: entry.name,
      size: entry.map.size,
      estimatedMemoryBytes: estimatedBytes,
      estimatedMemoryMB: estimatedBytes / (1024 * 1024),
    };
  });

  const totalBytes = caches.reduce((sum, cache) => sum + cache.estimatedMemoryBytes, 0);

  return {
    caches,
    total: totalBytes / (1024 * 1024),
  };
}

/**
 * Realiza verificação de saúde completa da aplicação
 */
export function performHealthCheck(): HealthCheckResponse {
  const errors: string[] = [];

  // Verificar se estado foi carregado
  if (!state.habits || state.habits.length === 0) {
    errors.push('No habits loaded');
  }

  // Verificar versão
  if (!state.version) {
    errors.push('App version not set');
  }

  // Verificar integridade de caches (se algum ficou vazio de repente)
  const cachesHealth = getCachesHealth();
  if (cachesHealth.total > 50) {
    errors.push(`High memory usage in caches: ${cachesHealth.total.toFixed(2)}MB`);
  }

  // Status geral
  const isOk = errors.length === 0;
  const isDegraded = errors.length > 0 && lastSyncStatus !== 'failed';
  const hasError = lastSyncStatus === 'failed' || errors.length > 1;

  const status = hasError ? 'error' : isDegraded ? 'degraded' : 'ok';

  const response: HealthCheckResponse = {
    status,
    timestamp: new Date().toISOString(),
    uptime: (Date.now() - appStartTime) / 1000, // em segundos
    appVersion: `v${state.version || '0.0.0'}`,
    syncStatus: lastSyncStatus,
    caches: cachesHealth.caches,
    totalCacheMemoryMB: cachesHealth.total,
  };

  if (errors.length > 0) {
    response.errors = errors;
  }

  return response;
}

/**
 * Reset de métricas (útil para testes)
 */
export function resetHealthMetrics(): void {
  lastSyncStatus = 'idle';
  lastSyncError = null;
  appStartTime = Date.now();
}

export default {
  performHealthCheck,
  setSyncStatus,
  resetHealthMetrics,
};
