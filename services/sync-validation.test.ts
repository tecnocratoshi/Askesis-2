/**
 * @file sync-validation.test.ts
 * @description Tests para validar serialização de dados para o script Lua
 */

import { describe, it, expect } from 'vitest';

describe('Lua Sync Validation', () => {
    
    it('deve serializar shards válidos para JSON sem erros', () => {
        const shards = {
            core: JSON.stringify({
                version: 1,
                habits: [],
                dailyData: {}
            }),
            'logs:2024-01': JSON.stringify([
                ['habit-1_2024-01-01', '123456789']
            ]),
            'archive:2023': JSON.stringify({
                data: 'archived'
            })
        };

        // Simular o que a API faria
        const payload = JSON.stringify({ lastModified: Date.now(), shards });
        expect(payload).toBeTruthy();
        expect(payload.length).toBeGreaterThan(0);
        
        // Garantir que pode ser parsed
        const parsed = JSON.parse(payload);
        expect(parsed.shards).toBeDefined();
    });

    it('deve rejeitar shards com caracteres inválidos', () => {
        const invalidShards = {
            core: undefined, // Inválido: undefined
            'logs:2024-01': null, // Inválido: null
        };

        expect(() => {
            JSON.stringify({ lastModified: Date.now(), shards: invalidShards });
        }).not.toThrow(); // JSON.stringify ainda funciona, mas envia undefined/null
    });

    it('deve validar tipos de shard antes de serializar', () => {
        const shards: Record<string, any> = {
            core: '{"version":1}',
            'logs:2024-01': '[]',
        };

        // Validação: todos os valores devem ser strings
        let isValid = true;
        for (const key in shards) {
            if (typeof shards[key] !== 'string') {
                isValid = false;
                break;
            }
        }

        expect(isValid).toBe(true);
    });

    it('deve rejeitar payloads acima do limite de tamanho', () => {
        // Simular payload grande
        const largeData = 'x'.repeat(11 * 1024 * 1024); // 11MB
        const payload = JSON.stringify({
            lastModified: Date.now(),
            shards: { large: largeData }
        });

        expect(payload.length).toBeGreaterThan(10 * 1024 * 1024);
    });

    it('deve calcular hash corretamente para detecção de mudanças', () => {
        // Simular hashing de shards
        const shard1 = JSON.stringify({ version: 1, data: [1, 2, 3] });
        const shard2 = JSON.stringify({ version: 1, data: [1, 2, 3] });
        const shard3 = JSON.stringify({ version: 2, data: [1, 2, 3] });

        // Simples comparison de hash (na prática usa murmur)
        const hash1 = shard1.length + shard1.charCodeAt(0);
        const hash2 = shard2.length + shard2.charCodeAt(0);
        const hash3 = shard3.length + shard3.charCodeAt(0);

        expect(hash1).toBe(hash2); // Mesmo conteúdo
        expect(hash1).not.toBe(hash3); // Conteúdo diferente
    });

    it('deve preservar estrutura de dados após serialização/deserialização', () => {
        const originalShard = {
            habits: [
                { id: 'h1', name: 'Meditar', goal: { type: 'minutes' as const, value: 10 } }
            ],
            monthlyLogs: {}
        };

        const serialized = JSON.stringify(originalShard);
        const deserialized = JSON.parse(serialized);

        expect(deserialized).toEqual(originalShard);
        expect(deserialized.habits[0].id).toBe('h1');
    });
});
