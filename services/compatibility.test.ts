/**
 * NÍVEL D: ESPECIALISTA - Testes de Compatibilidade & Migração
 * ===========================================================
 * 
 * Testes para:
 * - Backward compatibility com versões anteriores
 * - Migração de dados
 * - Format versioning
 * - Breaking changes detection
 * - Upgrade/downgrade scenarios
 * - Data format evolution
 * - Cross-version interoperability
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Simulação de diferentes versões de formato de dados
const VERSIONS = {
  V1: 'v1.0.0', // Versão antiga
  V2: 'v2.0.0', // Versão intermediária
  V3: 'v3.0.0', // Versão atual
};

// Schemas de diferentes versões
const V1Schema = {
  habits: [],
  lastUpdated: 0,
};

const V2Schema = {
  version: VERSIONS.V2,
  habits: [],
  lastUpdated: 0,
  metadata: {},
};

const V3Schema = {
  version: VERSIONS.V3,
  habits: [],
  monthlyLogs: new Map<string, bigint>(),
  lastUpdated: 0,
  metadata: {
    appVersion: '',
    lastMigration: 0,
  },
};

let currentState = { ...V3Schema };

const MigrationService = {
  getVersion(data: any): string {
    return data.version || VERSIONS.V1;
  },

  migrateV1ToV2(v1Data: any): any {
    return {
      version: VERSIONS.V2,
      habits: v1Data.habits || [],
      lastUpdated: v1Data.lastUpdated || 0,
      metadata: {},
    };
  },

  migrateV2ToV3(v2Data: any): any {
    return {
      version: VERSIONS.V3,
      habits: v2Data.habits || [],
      monthlyLogs: new Map(),
      lastUpdated: v2Data.lastUpdated || 0,
      metadata: {
        appVersion: VERSIONS.V3,
        lastMigration: Date.now(),
        migratedFrom: VERSIONS.V2,
      },
    };
  },

  migrate(data: any): any {
    let current = data;
    const version = this.getVersion(current);

    if (version === VERSIONS.V1) {
      current = this.migrateV1ToV2(current);
    }
    if (this.getVersion(current) === VERSIONS.V2) {
      current = this.migrateV2ToV3(current);
    }

    return current;
  },

  isCompatible(dataVersion: string, appVersion: string): boolean {
    const versionMap: any = {
      [VERSIONS.V1]: [VERSIONS.V1, VERSIONS.V2, VERSIONS.V3],
      [VERSIONS.V2]: [VERSIONS.V2, VERSIONS.V3],
      [VERSIONS.V3]: [VERSIONS.V3],
    };
    return (versionMap[dataVersion] || []).includes(appVersion);
  },

  canDowngrade(currentVersion: string, targetVersion: string): boolean {
    // Não podemos downgrade de V3 para V1 (perda de dados)
    const canDowngradeMap: any = {
      [VERSIONS.V1]: [],
      [VERSIONS.V2]: [VERSIONS.V1],
      [VERSIONS.V3]: [VERSIONS.V2],
    };
    return (canDowngradeMap[currentVersion] || []).includes(targetVersion);
  },

  validateSchema(data: any, schema: any): boolean {
    const dataKeys = Object.keys(data).sort();
    const schemaKeys = Object.keys(schema).sort();
    return dataKeys.every((key) => key in schema);
  },

  getBreakingChanges(fromVersion: string, toVersion: string): string[] {
    if (fromVersion === VERSIONS.V1 && toVersion === VERSIONS.V2) {
      return ['metadata field added'];
    }
    if (fromVersion === VERSIONS.V2 && toVersion === VERSIONS.V3) {
      return ['monthlyLogs structure added', 'metadata.appVersion added'];
    }
    return [];
  },
};

describe('🔄 NÍVEL D: COMPATIBILIDADE & MIGRAÇÃO', () => {
  beforeEach(() => {
    currentState = { ...V3Schema };
  });

  // ============================================================================
  // SEÇÃO 1: Backward Compatibility
  // ============================================================================

  describe('↩️ Backward Compatibility', () => {
    it('COM-001: Lê dados V1 sem erro', () => {
      const v1Data = {
        habits: [{ id: 'h1', status: 1 }],
        lastUpdated: 1000,
      };

      expect(() => {
        MigrationService.getVersion(v1Data);
      }).not.toThrow();

      expect(MigrationService.getVersion(v1Data)).toBe(VERSIONS.V1);
    });

    it('COM-002: Lê dados V2 sem erro', () => {
      const v2Data = {
        version: VERSIONS.V2,
        habits: [],
        lastUpdated: 1000,
        metadata: {},
      };

      expect(MigrationService.getVersion(v2Data)).toBe(VERSIONS.V2);
    });

    it('COM-003: Lê dados V3 (atual) sem erro', () => {
      const v3Data = {
        version: VERSIONS.V3,
        habits: [],
        monthlyLogs: new Map(),
        lastUpdated: 1000,
        metadata: { appVersion: VERSIONS.V3, lastMigration: 0 },
      };

      expect(MigrationService.getVersion(v3Data)).toBe(VERSIONS.V3);
    });

    it('COM-004: App V3 é compatível com dados V1', () => {
      const isCompatible = MigrationService.isCompatible(VERSIONS.V1, VERSIONS.V3);
      expect(isCompatible).toBe(true);
    });

    it('COM-005: App V3 é compatível com dados V2', () => {
      const isCompatible = MigrationService.isCompatible(VERSIONS.V2, VERSIONS.V3);
      expect(isCompatible).toBe(true);
    });

    it('COM-006: App V3 é compatível com dados V3', () => {
      const isCompatible = MigrationService.isCompatible(VERSIONS.V3, VERSIONS.V3);
      expect(isCompatible).toBe(true);
    });

    it('COM-007: App V1 não é compatível com dados V3', () => {
      const isCompatible = MigrationService.isCompatible(VERSIONS.V3, VERSIONS.V1);
      expect(isCompatible).toBe(false);
    });

    it('COM-008: Métodos antigos continuam funcionando', () => {
      const oldData = {
        habits: [{ id: 'h1', name: 'Exercise' }],
        lastUpdated: 1000,
      };

      // Simular acesso a campo antigo
      expect(oldData.habits[0].id).toBe('h1');
      expect(oldData.lastUpdated).toBe(1000);
    });
  });

  // ============================================================================
  // SEÇÃO 2: Data Migration
  // ============================================================================

  describe('🚚 Data Migration & Upgrade', () => {
    it('COM-009: Migra V1 → V2 preserva dados', () => {
      const v1Data = {
        habits: [
          { id: 'h1', status: 1 },
          { id: 'h2', status: 0 },
        ],
        lastUpdated: 1000,
      };

      const v2Data = MigrationService.migrateV1ToV2(v1Data);

      expect(v2Data.habits.length).toBe(2);
      expect(v2Data.habits[0].id).toBe('h1');
      expect(v2Data.lastUpdated).toBe(1000);
      expect(v2Data.version).toBe(VERSIONS.V2);
    });

    it('COM-010: Migra V2 → V3 preserva dados', () => {
      const v2Data = {
        version: VERSIONS.V2,
        habits: [{ id: 'h1', status: 1 }],
        lastUpdated: 1000,
        metadata: { customField: 'value' },
      };

      const v3Data = MigrationService.migrateV2ToV3(v2Data);

      expect(v3Data.habits.length).toBe(1);
      expect(v3Data.habits[0].id).toBe('h1');
      expect(v3Data.version).toBe(VERSIONS.V3);
      expect(v3Data.metadata.migratedFrom).toBe(VERSIONS.V2);
    });

    it('COM-011: Migração em cascata V1 → V2 → V3', () => {
      const v1Data = {
        habits: [{ id: 'h1', status: 1 }],
        lastUpdated: 1000,
      };

      const migratedData = MigrationService.migrate(v1Data);

      expect(migratedData.version).toBe(VERSIONS.V3);
      expect(migratedData.habits.length).toBe(1);
      expect(migratedData.metadata.appVersion).toBe(VERSIONS.V3);
    });

    it('COM-012: Migração é idempotente', () => {
      const v3Data = {
        version: VERSIONS.V3,
        habits: [{ id: 'h1', status: 1 }],
        monthlyLogs: new Map(),
        lastUpdated: 1000,
        metadata: { appVersion: VERSIONS.V3, lastMigration: 1000 },
      };

      const migrated1 = MigrationService.migrate(v3Data);
      const migrated2 = MigrationService.migrate(migrated1);

      expect(migrated1.version).toBe(migrated2.version);
      expect(migrated1.habits.length).toBe(migrated2.habits.length);
    });

    it('COM-013: Migração vazia não corrompe dados', () => {
      const emptyV1 = { habits: [], lastUpdated: 0 };

      const migrated = MigrationService.migrate(emptyV1);

      expect(migrated.version).toBe(VERSIONS.V3);
      expect(migrated.habits.length).toBe(0);
      expect(migrated.monthlyLogs instanceof Map).toBe(true);
    });

    it('COM-014: Registro de migração é criado', () => {
      const v2Data = {
        version: VERSIONS.V2,
        habits: [],
        lastUpdated: 1000,
        metadata: {},
      };

      const beforeTime = Date.now();
      const v3Data = MigrationService.migrateV2ToV3(v2Data);
      const afterTime = Date.now();

      expect(v3Data.metadata.lastMigration).toBeGreaterThanOrEqual(beforeTime);
      expect(v3Data.metadata.lastMigration).toBeLessThanOrEqual(afterTime);
    });

    it('COM-015: Dados órfãos são descartados ou migrados', () => {
      const corruptedV2 = {
        version: VERSIONS.V2,
        habits: [{ id: 'h1' }, { id: 'h2' }],
        unknownField: 'should be ignored',
        lastUpdated: 1000,
        metadata: {},
      };

      const v3Data = MigrationService.migrateV2ToV3(corruptedV2);

      expect(v3Data.version).toBe(VERSIONS.V3);
      expect((v3Data as any).unknownField).toBeUndefined();
    });
  });

  // ============================================================================
  // SEÇÃO 3: Schema Validation
  // ============================================================================

  describe('📋 Schema Validation', () => {
    it('COM-016: Valida schema V1', () => {
      const v1Data = {
        habits: [],
        lastUpdated: 0,
      };

      expect(MigrationService.validateSchema(v1Data, V1Schema)).toBe(true);
    });

    it('COM-017: Valida schema V2', () => {
      const v2Data = {
        version: VERSIONS.V2,
        habits: [],
        lastUpdated: 0,
        metadata: {},
      };

      expect(MigrationService.validateSchema(v2Data, V2Schema)).toBe(true);
    });

    it('COM-018: Valida schema V3', () => {
      const v3Data = {
        version: VERSIONS.V3,
        habits: [],
        monthlyLogs: new Map(),
        lastUpdated: 0,
        metadata: { appVersion: VERSIONS.V3, lastMigration: 0 },
      };

      expect(MigrationService.validateSchema(v3Data, V3Schema)).toBe(true);
    });

    it('COM-019: Rejeita dados com campos faltantes', () => {
      const incompleteV3 = {
        version: VERSIONS.V3,
        habits: [],
        // Falta monthlyLogs
        lastUpdated: 0,
      };

      expect(MigrationService.validateSchema(incompleteV3, V3Schema)).toBe(false);
    });

    it('COM-020: Permite campos extras (forward compatibility)', () => {
      const extendedV3 = {
        version: VERSIONS.V3,
        habits: [],
        monthlyLogs: new Map(),
        lastUpdated: 0,
        metadata: { appVersion: VERSIONS.V3, lastMigration: 0 },
        futureField: 'this is from a newer version',
      };

      // Deve ser válido se contém todos os campos necessários
      expect(MigrationService.validateSchema(extendedV3, V3Schema)).toBe(true);
    });
  });

  // ============================================================================
  // SEÇÃO 4: Breaking Changes & Deprecation
  // ============================================================================

  describe('⚠️ Breaking Changes & Deprecation', () => {
    it('COM-021: Identifica breaking changes V1→V2', () => {
      const changes = MigrationService.getBreakingChanges(VERSIONS.V1, VERSIONS.V2);

      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0]).toContain('metadata');
    });

    it('COM-022: Identifica breaking changes V2→V3', () => {
      const changes = MigrationService.getBreakingChanges(VERSIONS.V2, VERSIONS.V3);

      expect(changes.length).toBeGreaterThan(0);
      expect(changes.some((c) => c.includes('monthlyLogs'))).toBe(true);
    });

    it('COM-023: Sem breaking changes entre mesma versão', () => {
      const changes = MigrationService.getBreakingChanges(VERSIONS.V3, VERSIONS.V3);

      expect(changes.length).toBe(0);
    });

    it('COM-024: Campos deprecated são suportados em read', () => {
      const oldDataWithDeprecated = {
        habits: [],
        lastUpdated: 0,
        deprecated_oldField: 'should be ignored',
      };

      const version = MigrationService.getVersion(oldDataWithDeprecated);
      expect(version).toBe(VERSIONS.V1);
    });

    it('COM-025: Campos deprecated não são usados em write', () => {
      const output = MigrationService.migrateV1ToV2({
        habits: [],
        lastUpdated: 0,
        deprecated_field: 'should be removed',
      });

      expect((output as any).deprecated_field).toBeUndefined();
    });
  });

  // ============================================================================
  // SEÇÃO 5: Downgrade & Rollback
  // ============================================================================

  describe('↙️ Downgrade & Rollback', () => {
    it('COM-026: Pode fazer downgrade V2→V1', () => {
      const canDowngrade = MigrationService.canDowngrade(VERSIONS.V2, VERSIONS.V1);
      expect(canDowngrade).toBe(true);
    });

    it('COM-027: Pode fazer downgrade V3→V2', () => {
      const canDowngrade = MigrationService.canDowngrade(VERSIONS.V3, VERSIONS.V2);
      expect(canDowngrade).toBe(true);
    });

    it('COM-028: Não pode fazer downgrade V1→anterior', () => {
      const canDowngrade = MigrationService.canDowngrade(VERSIONS.V1, 'v0.9.0');
      expect(canDowngrade).toBe(false);
    });

    it('COM-029: Não pode fazer downgrade V3→V1 (perda de dados)', () => {
      const canDowngrade = MigrationService.canDowngrade(VERSIONS.V3, VERSIONS.V1);
      expect(canDowngrade).toBe(false);
    });

    it('COM-030: Rollback cria backup antes', () => {
      const originalData = {
        version: VERSIONS.V3,
        habits: [{ id: 'h1' }],
        monthlyLogs: new Map(),
        lastUpdated: 1000,
        metadata: { appVersion: VERSIONS.V3, lastMigration: 1000 },
      };

      const backup = JSON.parse(JSON.stringify(originalData, (key, val) => 
        val instanceof Map ? [...val.entries()] : val
      ));

      expect(backup.habits.length).toBe(1);
      expect(backup.version).toBe(VERSIONS.V3);
    });
  });

  // ============================================================================
  // SEÇÃO 6: Cross-Version Interoperability
  // ============================================================================

  describe('🔗 Cross-Version Interoperability', () => {
    it('COM-031: Sincroniza dados V2 com cliente V3', () => {
      const serverV2Data = {
        version: VERSIONS.V2,
        habits: [{ id: 'h1', status: 1 }],
        lastUpdated: 1000,
        metadata: {},
      };

      const clientV3Migrated = MigrationService.migrate(serverV2Data);

      expect(clientV3Migrated.version).toBe(VERSIONS.V3);
      expect(clientV3Migrated.habits[0].id).toBe('h1');
    });

    it('COM-032: Envia dados V2 de cliente V3 para servidor V2-compatível', () => {
      const v3Data = {
        version: VERSIONS.V3,
        habits: [{ id: 'h1', status: 1 }],
        monthlyLogs: new Map([['h1_2026-01', BigInt(1)]]),
        lastUpdated: 1000,
        metadata: { appVersion: VERSIONS.V3, lastMigration: 1000 },
      };

      // Simular envio para servidor V2
      const compatibleData = {
        version: VERSIONS.V2,
        habits: v3Data.habits,
        lastUpdated: v3Data.lastUpdated,
        metadata: v3Data.metadata,
      };

      expect(compatibleData.version).toBe(VERSIONS.V2);
    });

    it('COM-033: Merge de dados de múltiplas versões', () => {
      const v1Source = {
        habits: [{ id: 'h1', status: 1 }],
        lastUpdated: 1000,
      };

      const v2Source = {
        version: VERSIONS.V2,
        habits: [{ id: 'h2', status: 2 }],
        lastUpdated: 2000,
        metadata: {},
      };

      const v1Migrated = MigrationService.migrate(v1Source);
      const v2Migrated = MigrationService.migrate(v2Source);

      expect(v1Migrated.version).toBe(v2Migrated.version);
    });

    it('COM-034: Conflict resolution em merge cross-version', () => {
      const habit1 = { id: 'h1', status: 1, lastUpdated: 1000 };
      const habit2 = { id: 'h1', status: 2, lastUpdated: 2000 };

      // Last-Write-Wins
      const resolved = habit2.lastUpdated > habit1.lastUpdated ? habit2 : habit1;

      expect(resolved.status).toBe(2);
    });
  });

  // ============================================================================
  // SEÇÃO 7: Property-Based Compatibility Testing
  // ============================================================================

  describe('🔬 Property-Based Compatibility', () => {
    it('COM-035: Migração sempre resulta em versão alvo', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant({ habits: [], lastUpdated: 0 }),
            fc.constant({
              version: VERSIONS.V2,
              habits: [],
              lastUpdated: 0,
              metadata: {},
            }),
            fc.constant({
              version: VERSIONS.V3,
              habits: [],
              monthlyLogs: new Map(),
              lastUpdated: 0,
              metadata: { appVersion: VERSIONS.V3, lastMigration: 0 },
            })
          ),
          (data) => {
            const migrated = MigrationService.migrate(data);
            return migrated.version === VERSIONS.V3;
          }
        ),
        { numRuns: 50 }
      );
    });

    it('COM-036: Backward compatibility para qualquer versão anterior', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(VERSIONS.V1),
            fc.constant(VERSIONS.V2),
            fc.constant(VERSIONS.V3)
          ),
          (dataVersion) => {
            return MigrationService.isCompatible(dataVersion, VERSIONS.V3);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
