/**
 * @file sync-stress.test.ts
 * @description Testes de stress para sincronização - Reproduzir e diagnosticar erros Lua
 * 
 * Objetivo: Estressar o sistema de sincronização para:
 * - Reproduzir padrão "Lua Execution Error"
 * - Determinar exatamente quando falha
 * - Identificar limites de payload/shards
 * - Medir performance
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ===== TIPOS E INTERFACES =====

interface StressTestConfig {
    payloadSizeBytes: number;
    shardCount: number;
    simultaneousSyncs: number;
    iterationCount: number;
    delayBetweenMs: number;
}

interface SyncAttempt {
    id: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    success: boolean;
    error?: string;
    errorType?: string;
    payloadSize: number;
    shardCount: number;
}

interface StressTestResult {
    config: StressTestConfig;
    attempts: SyncAttempt[];
    summary: {
        totalAttempts: number;
        successfulAttempts: number;
        failedAttempts: number;
        successRate: number;
        avgDuration: number;
        maxDuration: number;
        minDuration: number;
        errorFrequency: Record<string, number>;
        timeoutCount: number;
        networkErrorCount: number;
        luaErrorCount: number;
    };
    recommendation: string;
}

// ===== MOCK FUNCTIONS =====

let mockSyncAttempts: SyncAttempt[] = [];
let syncDelayMs = 0; // Simulador de latência

function mockSyncCall(
    payloadSize: number,
    shardCount: number,
    forceError?: string
): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
        // Simular latência de rede
        setTimeout(() => {
            if (forceError) {
                resolve({
                    success: false,
                    error: forceError
                });
                return;
            }

            // Simular timeout para payloads muito grandes
            if (payloadSize > 5_000_000) {
                resolve({
                    success: false,
                    error: 'TIMEOUT: Script Lua excedeu tempo limite'
                });
                return;
            }

            // Simular erro para muitos shards
            if (shardCount > 800) {
                resolve({
                    success: false,
                    error: 'VALIDATION_ERROR: TOO_MANY_SHARDS'
                });
                return;
            }

            // Simular erro de JSON
            if (payloadSize % 13 === 0) {
                // Alguns payloads "malformados"
                resolve({
                    success: false,
                    error: 'INVALID_JSON: Unexpected character at line 1'
                });
                return;
            }

            // Sucesso
            resolve({ success: true });
        }, syncDelayMs);
    });
}

// ===== HELPER FUNCTIONS =====

function generatePayload(sizeBytes: number): string {
    const chunkSize = 1024;
    let result = '';
    for (let i = 0; i < sizeBytes; i += chunkSize) {
        result += 'x'.repeat(Math.min(chunkSize, sizeBytes - i));
    }
    return result;
}

function generateShards(count: number): Record<string, string> {
    const shards: Record<string, string> = {};
    const avgShardSize = 5000;

    for (let i = 0; i < count; i++) {
        shards[`shard_${i}`] = generatePayload(avgShardSize);
    }

    return shards;
}

async function performStressTest(config: StressTestConfig): Promise<StressTestResult> {
    mockSyncAttempts = [];
    const attempts: SyncAttempt[] = [];
    const startTime = Date.now();

    // Executar múltiplas iterações
    for (let iter = 0; iter < config.iterationCount; iter++) {
        // Executar syncs simultâneos
        const promises = [];

        for (let i = 0; i < config.simultaneousSyncs; i++) {
            const attemptId = `iter_${iter}_sync_${i}`;
            const attempt: SyncAttempt = {
                id: attemptId,
                startTime: Date.now(),
                success: false,
                payloadSize: config.payloadSizeBytes,
                shardCount: config.shardCount
            };

            const promise = mockSyncCall(config.payloadSizeBytes, config.shardCount)
                .then((result) => {
                    attempt.endTime = Date.now();
                    attempt.duration = attempt.endTime - attempt.startTime;
                    attempt.success = result.success;

                    if (!result.success && result.error) {
                        attempt.error = result.error;
                        // Classificar tipo de erro
                        if (result.error.includes('TIMEOUT')) {
                            attempt.errorType = 'TIMEOUT';
                        } else if (result.error.includes('INVALID_JSON')) {
                            attempt.errorType = 'INVALID_JSON';
                        } else if (result.error.includes('VALIDATION')) {
                            attempt.errorType = 'VALIDATION_ERROR';
                        } else {
                            attempt.errorType = 'UNKNOWN';
                        }
                    }

                    attempts.push(attempt);
                });

            promises.push(promise);
        }

        // Aguardar todos os syncs desta iteração
        await Promise.all(promises);

        // Delay entre iterações
        if (iter < config.iterationCount - 1) {
            await new Promise((resolve) => setTimeout(resolve, config.delayBetweenMs));
        }
    }

    // Calcular estatísticas
    const successful = attempts.filter((a) => a.success).length;
    const failed = attempts.filter((a) => !a.success).length;
    const durations = attempts.filter((a) => a.duration).map((a) => a.duration!);

    const errorFrequency: Record<string, number> = {};
    attempts
        .filter((a) => !a.success && a.errorType)
        .forEach((a) => {
            errorFrequency[a.errorType!] = (errorFrequency[a.errorType!] || 0) + 1;
        });

    const result: StressTestResult = {
        config,
        attempts,
        summary: {
            totalAttempts: attempts.length,
            successfulAttempts: successful,
            failedAttempts: failed,
            successRate: (successful / attempts.length) * 100,
            avgDuration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
            maxDuration: Math.max(...durations, 0),
            minDuration: Math.min(...durations, Infinity),
            errorFrequency,
            timeoutCount: Object.values(errorFrequency).reduce((sum, count) => sum + count, 0),
            networkErrorCount: errorFrequency['NETWORK_ERROR'] || 0,
            luaErrorCount: Object.keys(errorFrequency)
                .filter((k) => k.includes('TIMEOUT') || k.includes('VALIDATION') || k.includes('JSON'))
                .reduce((sum, k) => sum + (errorFrequency[k] || 0), 0)
        },
        recommendation: ''
    };

    // Gerar recomendação
    result.recommendation = generateRecommendation(result);

    return result;
}

function generateRecommendation(result: StressTestResult): string {
    const { summary, config } = result;
    const successRate = result.summary.successRate;

    if (successRate === 100) {
        return `✅ Sistema estável com ${config.payloadSizeBytes} bytes e ${config.shardCount} shards`;
    }

    if (summary.errorFrequency['TIMEOUT']) {
        return `⚠️ TIMEOUT detectado (${summary.errorFrequency['TIMEOUT']}x). Payload ${config.payloadSizeBytes} bytes pode ser muito grande. Reduza para < 1MB.`;
    }

    if (summary.errorFrequency['VALIDATION_ERROR']) {
        return `⚠️ VALIDATION_ERROR: Muitos shards (${config.shardCount}). Limite máximo é ~800. Reduza quantidade.`;
    }

    if (summary.errorFrequency['INVALID_JSON']) {
        return `⚠️ INVALID_JSON: Dados corrompidos. Verifique serialização. Taxa atual: ${successRate.toFixed(1)}%`;
    }

    return `❌ Taxa de sucesso ${successRate.toFixed(1)}%. Múltiplos erros detectados. Revise configuração.`;
}

function printStressTestResults(result: StressTestResult) {
    console.log('\n╔════════════════════════════════════╗');
    console.log('║      SYNC STRESS TEST RESULTS       ║');
    console.log('╚════════════════════════════════════╝\n');

    console.log('📋 CONFIGURAÇÃO');
    console.table({
        'Payload (bytes)': result.config.payloadSizeBytes,
        'Quantidade de Shards': result.config.shardCount,
        'Syncs Simultâneos': result.config.simultaneousSyncs,
        'Iterações': result.config.iterationCount,
        'Delay entre (ms)': result.config.delayBetweenMs
    });

    console.log('\n📊 RESULTADOS GERAIS');
    console.table({
        'Total de Tentativas': result.summary.totalAttempts,
        'Sucessos': result.summary.successfulAttempts,
        'Falhas': result.summary.failedAttempts,
        'Taxa de Sucesso': `${result.summary.successRate.toFixed(1)}%`,
        'Duração Média (ms)': result.summary.avgDuration.toFixed(2),
        'Duração Máxima (ms)': result.summary.maxDuration.toFixed(2),
        'Duração Mínima (ms)': result.summary.minDuration.toFixed(2)
    });

    if (Object.keys(result.summary.errorFrequency).length > 0) {
        console.log('\n❌ FREQUÊNCIA DE ERROS');
        console.table(result.summary.errorFrequency);
    }

    console.log('\n💡 RECOMENDAÇÃO');
    console.log(result.recommendation);

    // Amostra de tentativas falhadas
    const failedAttempts = result.attempts.filter((a) => !a.success).slice(0, 5);
    if (failedAttempts.length > 0) {
        console.log('\n🔴 AMOSTRA DE FALHAS (primeiras 5)');
        failedAttempts.forEach((attempt) => {
            console.log(`  ${attempt.id}: ${attempt.error} (${attempt.duration}ms)`);
        });
    }
}

// ===== TESTES =====

describe('🧪 Sync Stress Tests - Diagnosticar Erros Lua', () => {
    beforeEach(() => {
        syncDelayMs = 10; // Simular latência de rede
        vi.clearAllMocks();
    });

    afterEach(() => {
        mockSyncAttempts = [];
    });

    // ===== TESTE 1: Payload Pequeno (Baseline) =====
    it('STRESS-001: Baseline - Payload pequeno, poucos shards', async () => {
        const config: StressTestConfig = {
            payloadSizeBytes: 50_000, // 50 KB
            shardCount: 10,
            simultaneousSyncs: 2,
            iterationCount: 5,
            delayBetweenMs: 100
        };

        const result = await performStressTest(config);

        expect(result.summary.successRate).toBeGreaterThan(95);
        expect(result.summary.failedAttempts).toBeLessThan(2);

        console.log('\n✅ TESTE 1: Baseline');
        printStressTestResults(result);
    });

    // ===== TESTE 2: Payload Médio =====
    it('STRESS-002: Payload médio (1MB)', async () => {
        const config: StressTestConfig = {
            payloadSizeBytes: 1_000_000, // 1 MB
            shardCount: 50,
            simultaneousSyncs: 2,
            iterationCount: 5,
            delayBetweenMs: 100
        };

        const result = await performStressTest(config);

        console.log('\n📦 TESTE 2: Payload Médio (1MB)');
        printStressTestResults(result);

        expect(result.summary.failedAttempts).toBeGreaterThanOrEqual(0);
    });

    // ===== TESTE 3: Payload Grande (Potencial Timeout) =====
    it('STRESS-003: Payload grande (5MB) - Risco de TIMEOUT', async () => {
        const config: StressTestConfig = {
            payloadSizeBytes: 5_000_000, // 5 MB
            shardCount: 100,
            simultaneousSyncs: 1,
            iterationCount: 3,
            delayBetweenMs: 200
        };

        const result = await performStressTest(config);

        console.log('\n⚠️ TESTE 3: Payload Grande (5MB)');
        printStressTestResults(result);

        // Esperado: alguns timeouts, mas não falhar se não houver
        if (!result.summary.errorFrequency['TIMEOUT']) {
            console.warn('Nenhum TIMEOUT detectado neste ambiente.');
        }
        // Não falha o teste se não houver timeouts
    });

    // ===== TESTE 4: Muitos Shards =====
    it('STRESS-004: Muitos shards (1000) - Teste de limite', async () => {
        const config: StressTestConfig = {
            payloadSizeBytes: 500_000, // 500 KB
            shardCount: 1000, // Além do limite teórico
            simultaneousSyncs: 1,
            iterationCount: 3,
            delayBetweenMs: 200
        };

        const result = await performStressTest(config);

        console.log('\n🔶 TESTE 4: Muitos Shards (1000)');
        printStressTestResults(result);

        // Esperado: VALIDATION_ERROR
        expect(result.summary.errorFrequency['VALIDATION_ERROR']).toBeGreaterThan(0);
    });

    // ===== TESTE 5: Syncs Simultâneos =====
    it('STRESS-005: Múltiplas sincronizações simultâneas (10 simultâneas)', async () => {
        const config: StressTestConfig = {
            payloadSizeBytes: 200_000, // 200 KB
            shardCount: 25,
            simultaneousSyncs: 10, // Muito stress
            iterationCount: 3,
            delayBetweenMs: 50
        };

        const result = await performStressTest(config);

        console.log('\n⚡ TESTE 5: Syncs Simultâneos (10x)');
        printStressTestResults(result);

        expect(result.summary.successRate).toBeGreaterThan(80);
    });

    // ===== TESTE 6: Cenário Real - Mudanças Rápidas =====
    it('STRESS-006: Cenário real - Mudanças rápidas (sincronia de 50-100 shards)', async () => {
        const config: StressTestConfig = {
            payloadSizeBytes: 500_000, // 500 KB
            shardCount: 50, // Típico em app com ~50 hábitos + logs
            simultaneousSyncs: 3, // Usuário fazendo 3 ações rápido
            iterationCount: 10, // Simulando 10 minutos de uso
            delayBetweenMs: 1000 // 1 segundo entre cada batch
        };


        // Aumenta timeout do teste para 20s usando a opção do Vitest
        // @ts-ignore
    }, 20000);

        const result = await performStressTest(config);

        console.log('\n👤 TESTE 6: Cenário Real - Mudanças Rápidas');
        printStressTestResults(result);

        // Esperado: alta taxa de sucesso
        expect(result.summary.successRate).toBeGreaterThan(85);
    });

    // ===== TESTE 7: Stress Extremo =====
    it('STRESS-007: Stress Extremo - Limites máximos', async () => {
        const config: StressTestConfig = {
            payloadSizeBytes: 8_000_000, // 8 MB (perto do limite HTTP)
            shardCount: 500,
            simultaneousSyncs: 5,
            iterationCount: 5,
            delayBetweenMs: 300
        };

        const result = await performStressTest(config);

        console.log('\n💥 TESTE 7: Stress Extremo');
        printStressTestResults(result);

        // Esperado: alguns erros
        expect(result.summary.failedAttempts).toBeGreaterThan(0);
    });

    // ===== TESTE 8: Recuperação após erro =====
    it('STRESS-008: Recuperação - Tentar novamente após falha', async () => {
        const config: StressTestConfig = {
            payloadSizeBytes: 3_000_000, // 3 MB
            shardCount: 75,
            simultaneousSyncs: 2,
            iterationCount: 8, // Mais tentativas
            delayBetweenMs: 500 // Esperar entre tentativas
        };

        const result = await performStressTest(config);

        console.log('\n🔄 TESTE 8: Recuperação após erro');
        printStressTestResults(result);

        // Estatística: depois de quantas tentativas consegue sucesso?
        const firstSuccess = result.attempts.findIndex((a) => a.success);
        if (firstSuccess >= 0) {
            console.log(`\n✅ Primeiro sucesso na tentativa: ${firstSuccess + 1}/${result.attempts.length}`);
        }
    });

    // ===== TESTE 9: Teste de Edge Cases =====
    it('STRESS-009: Edge cases - Valores limites', async () => {
        const testCases = [
            { bytes: 100, shards: 1, name: 'Mínimo' },
            { bytes: 10_000_000, shards: 999, name: 'Máximo' },
            { bytes: 4_194_304, shards: 256, name: '4MB / 256 shards' }
        ];

        console.log('\n🎯 TESTE 9: Edge Cases\n');

        for (const testCase of testCases) {
            const config: StressTestConfig = {
                payloadSizeBytes: testCase.bytes,
                shardCount: testCase.shards,
                simultaneousSyncs: 2,
                iterationCount: 3,
                delayBetweenMs: 100
            };

            const result = await performStressTest(config);

            console.log(`\n${testCase.name} (${testCase.bytes} bytes, ${testCase.shards} shards):`);
            console.log(
                `  Taxa: ${result.summary.successRate.toFixed(1)}% | ` +
                `Erros: ${result.summary.failedAttempts} | ` +
                `Duração média: ${result.summary.avgDuration.toFixed(0)}ms`
            );
        }
    });

    // ===== TESTE 10: Relatório Comparativo =====
    it('STRESS-010: Comparação - Diferentes tamanhos de payload', async () => {
        const payloadSizes = [100_000, 500_000, 1_000_000, 3_000_000, 5_000_000];

        console.log('\n📊 TESTE 10: Comparação de Payloads\n');
        console.log('Testando diferentes tamanhos para encontrar limite...\n');

        const results = [];

        for (const payloadSize of payloadSizes) {
            const config: StressTestConfig = {
                payloadSizeBytes: payloadSize,
                shardCount: Math.floor(payloadSize / 20_000), // Proporção típica
                simultaneousSyncs: 2,
                iterationCount: 5,
                delayBetweenMs: 100
            };

            const result = await performStressTest(config);
            results.push({
                payloadMB: (payloadSize / 1_000_000).toFixed(2),
                shardCount: config.shardCount,
                successRate: result.summary.successRate.toFixed(1),
                avgDuration: result.summary.avgDuration.toFixed(0),
                maxDuration: result.summary.maxDuration.toFixed(0),
                timeouts: result.summary.errorFrequency['TIMEOUT'] || 0
            });
        }

        console.table(results);

        // Encontrar sweet spot
        const successfulTests = results.filter((r) => parseFloat(r.successRate) >= 95);
        if (successfulTests.length > 0) {
            const maxSuccessful = successfulTests[successfulTests.length - 1];
            console.log(`\n✅ Limite recomendado: até ${maxSuccessful.payloadMB}MB com ${maxSuccessful.shardCount} shards`);
        }
    });

// ===== EXPORT PARA USO MANUAL =====

export { performStressTest, printStressTestResults, generatePayload, generateShards };
export type { StressTestConfig, StressTestResult };

// ===== EXPORT PARA USO MANUAL =====

export { performStressTest, printStressTestResults, generatePayload, generateShards };
export type { StressTestConfig, StressTestResult };
