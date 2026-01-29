# 🧪 Guia: Testes de Stress para Diagnosticar Erros Lua

## 🎯 O que foi criado

Um conjunto completo de testes que **estressam o sistema de sincronização** para reproduzir e diagnosticar o padrão de "Lua Execution Error".

**Arquivo:** `/services/sync-stress.test.ts`

---

## 📋 Testes Disponíveis (10 cenários)

### 1. **STRESS-001: Baseline** 
```
- Payload: 50 KB (pequeno)
- Shards: 10
- Sincronizações simultâneas: 2
- Iterações: 5

Objetivo: Verificar se sistema funciona normalmente
Esperado: 95%+ de sucesso
```

### 2. **STRESS-002: Payload Médio**
```
- Payload: 1 MB
- Shards: 50
- Sincronizações simultâneas: 2
- Iterações: 5

Objetivo: Testar com dados reais
Esperado: >90% de sucesso
```

### 3. **STRESS-003: Payload Grande (Risco de Timeout)**
```
- Payload: 5 MB ⚠️
- Shards: 100
- Sincronizações simultâneas: 1
- Iterações: 3

Objetivo: Reproduzir timeouts
Esperado: Alguns TOUTIMEOUTs detectados
```

### 4. **STRESS-004: Muitos Shards (Teste de Limite)**
```
- Payload: 500 KB
- Shards: 1000 ⚠️ (acima do limite)
- Sincronizações simultâneas: 1
- Iterações: 3

Objetivo: Encontrar limite de shards
Esperado: VALIDATION_ERROR (TOO_MANY_SHARDS)
```

### 5. **STRESS-005: Múltiplas Sincronizações Simultâneas**
```
- Payload: 200 KB
- Shards: 25
- Sincronizações simultâneas: 10 ⚡
- Iterações: 3

Objetivo: Simular usuário rápido fazendo várias mudanças
Esperado: >80% de sucesso mesmo com concorrência
```

### 6. **STRESS-006: Cenário Real - Mudanças Rápidas**
```
- Payload: 500 KB (típico)
- Shards: 50 (típico com ~50 hábitos)
- Sincronizações simultâneas: 3 (ações rápidas)
- Iterações: 10 (10 minutos de uso)
- Delay: 1 segundo entre batches

Objetivo: Simular uso normal do app
Esperado: >85% de sucesso
```

### 7. **STRESS-007: Stress Extremo**
```
- Payload: 8 MB (perto do limite HTTP)
- Shards: 500
- Sincronizações simultâneas: 5
- Iterações: 5

Objetivo: Encontrar breaking point
Esperado: Múltiplos erros, sobretudo TIMEOUT
```

### 8. **STRESS-008: Recuperação após Erro**
```
- Payload: 3 MB
- Shards: 75
- Sincronizações simultâneas: 2
- Iterações: 8 (mais tentativas)
- Delay: 500ms (esperar entre tentativas)

Objetivo: Verificar se retry automático recupera
Esperado: Sucesso em tentativas posteriores
```

### 9. **STRESS-009: Edge Cases**
```
Testa 3 casos extremos:
1. Mínimo: 100 bytes, 1 shard
2. Máximo: 10MB, 999 shards
3. Típico máx: 4MB, 256 shards

Objetivo: Identificar edge cases
Esperado: Entender limites reais
```

### 10. **STRESS-010: Comparação de Payloads**
```
Compara diferentes tamanhos:
- 100 KB
- 500 KB
- 1 MB
- 3 MB
- 5 MB

Objetivo: Encontrar sweet spot (melhor relação tamanho/performance)
Esperado: Tabela mostrando taxa de sucesso por tamanho
```

---

## 🚀 Como Executar

### Opção 1: Executar Todos os Testes

```bash
npm test -- sync-stress.test.ts
# ou
vitest sync-stress.test.ts
```

### Opção 2: Executar Teste Específico

```bash
# Teste Baseline
npm test -- sync-stress.test.ts -t "STRESS-001"

# Teste Payload Grande
npm test -- sync-stress.test.ts -t "STRESS-003"

# Teste Cenário Real
npm test -- sync-stress.test.ts -t "STRESS-006"

# Comparação de Payloads (o mais informativo)
npm test -- sync-stress.test.ts -t "STRESS-010"
```

### Opção 3: Modo Watch (Reexecuta ao salvar)

```bash
npm test -- sync-stress.test.ts --watch
```

### Opção 4: Com Output Detalhado

```bash
npm test -- sync-stress.test.ts --reporter=verbose
```

---

## 📊 Entendendo o Output

### Exemplo de Output para STRESS-003 (Timeout)

```
✅ TESTE 3: Payload Grande (5MB)

📋 CONFIGURAÇÃO
┌─────────────────────────┬──────────────┐
│ Payload (bytes)         │ 5000000      │
│ Quantidade de Shards    │ 100          │
│ Syncs Simultâneos       │ 1            │
│ Iterações               │ 3            │
│ Delay entre (ms)        │ 200          │
└─────────────────────────┴──────────────┘

📊 RESULTADOS GERAIS
┌─────────────────────┬────────┐
│ Total de Tentativas │ 3      │
│ Sucessos            │ 0      │
│ Falhas              │ 3      │
│ Taxa de Sucesso     │ 0.0%   │
│ Duração Média (ms)  │ 10.50  │
│ Duração Máxima (ms) │ 15.00  │
│ Duração Mínima (ms) │ 8.00   │
└─────────────────────┴────────┘

❌ FREQUÊNCIA DE ERROS
┌─────────┬───────┐
│ TIMEOUT │ 3     │
└─────────┴───────┘

💡 RECOMENDAÇÃO
⚠️ TIMEOUT detectado (3x). Payload 5000000 bytes pode ser muito 
grande. Reduza para < 1MB.

🔴 AMOSTRA DE FALHAS (primeiras 5)
  iter_0_sync_0: TIMEOUT: Script Lua excedeu tempo limite (10ms)
  iter_1_sync_0: TIMEOUT: Script Lua excedeu tempo limite (12ms)
  iter_2_sync_0: TIMEOUT: Script Lua excedeu tempo limite (11ms)
```

### Interpretação:
- ❌ **Taxa 0%** = Payload muito grande, sempre falha
- 💡 **Recomendação** = Solução exata
- 🔴 **Amostra** = Exemplos de tentativas que falharam

---

### Exemplo de Output para STRESS-010 (Comparação)

```
📊 TESTE 10: Comparação de Payloads

Testando diferentes tamanhos para encontrar limite...

┌───────────┬──────────────┬──────────────┬────────────┬────────────┬──────────┐
│ payloadMB │ shardCount   │ successRate  │ avgDuration│ maxDuration│ timeouts │
├───────────┼──────────────┼──────────────┼────────────┼────────────┼──────────┤
│ 0.10      │ 5            │ 100.0%       │ 10         │ 15         │ 0        │
│ 0.50      │ 25           │ 100.0%       │ 11         │ 18         │ 0        │
│ 1.00      │ 50           │ 100.0%       │ 12         │ 20         │ 0        │
│ 3.00      │ 150          │ 80.0%        │ 15         │ 45         │ 3        │
│ 5.00      │ 250          │ 0.0%         │ 11         │ 13         │ 10       │
└───────────┴──────────────┴──────────────┴────────────┴────────────┴──────────┘

✅ Limite recomendado: até 1.00MB com 50 shards
```

### Interpretação:
- **0.10-1.00 MB**: 100% sucesso → Seguro usar
- **3.00 MB**: 80% sucesso → Risco, mas possível
- **5.00 MB**: 0% sucesso → NUNCA usar, sempre falha

**Conclusão:** Recomendação é usar **máximo 1 MB** com até 50 shards

---

## 🔍 O que os Testes Procuram

### Errors Detectados Automaticamente:

1. **TIMEOUT**
   - Script Lua demorando demais
   - Payload muito grande
   - Indica: Reduza tamanho

2. **VALIDATION_ERROR**
   - Muitos shards (> 800)
   - Indica: Reduza quantidade de shards

3. **INVALID_JSON**
   - Dados corrompidos
   - Serialização falha
   - Indica: Verifique dados

4. **NETWORK_ERROR**
   - Conexão instável
   - Indica: Tente novamente

---

## 💡 Como Usar para Diagnosticar Seu Problema

### Cenário: Você está vendo "Lua Execution Error"

**Passo 1:** Execute o teste mais relevante
```bash
# Se usa muitos hábitos:
npm test -- sync-stress.test.ts -t "STRESS-006"

# Se quer encontrar o limite exato:
npm test -- sync-stress.test.ts -t "STRESS-010"

# Se quer stress máximo:
npm test -- sync-stress.test.ts -t "STRESS-007"
```

**Passo 2:** Verifique a recomendação
```
Procure por: "💡 RECOMENDAÇÃO"
Leia a mensagem de solução
```

**Passo 3:** Ajuste sua app
Se diz "Reduza para < 1MB", seu app está:
- Sincronizando muitos shards
- Com payloads muito grandes
- Precisa de otimização

---

## 📈 Métricas Importantes

Ao ler os resultados, procure por:

### Taxa de Sucesso
- ✅ `> 95%` = Sistema estável
- ⚠️ `80-95%` = Algum stress, mas tolerável
- ❌ `< 80%` = Problemas sérios

### Duração (ms)
- ✅ `< 20ms` = Rápido
- ⚠️ `20-100ms` = Normal
- ❌ `> 100ms` = Muito lento (indica limite atingido)

### Erros
- ✅ `0 errors` = Perfeito
- ⚠️ `1-3 errors` = Ocasional
- ❌ `> 5 errors` = Padrão problemático

---

## 🎯 Casos de Uso Reais

### Caso 1: "Minha app é lenta ao sincronizar"
```bash
npm test -- sync-stress.test.ts -t "STRESS-010"
# Descobre em qual tamanho de payload fica lento
```

### Caso 2: "Tenho ~100 hábitos, sync falha às vezes"
```bash
npm test -- sync-stress.test.ts -t "STRESS-004"
# Verifica se muitos shards causam VALIDATION_ERROR
```

### Caso 3: "Erro Lua ao fazer mudanças rápidas"
```bash
npm test -- sync-stress.test.ts -t "STRESS-005"
# Simula múltiplas sincronizações simultâneas
```

### Caso 4: "Preciso saber se é problema de servidor"
```bash
npm test -- sync-stress.test.ts -t "STRESS-003"
# Testa payload grande isoladamente
```

### Caso 5: "Quero encontrar o limite máximo"
```bash
npm test -- sync-stress.test.ts -t "STRESS-007"
# Stress extremo para encontrar breaking point
```

---

## 🔧 Personalizando os Testes

Se quiser testar uma configuração específica:

### Editar o arquivo e adicionar novo teste:

```typescript
it('CUSTOM: Meu caso específico', async () => {
    const config: StressTestConfig = {
        payloadSizeBytes: 750_000,      // Seu tamanho
        shardCount: 75,                  // Seus shards
        simultaneousSyncs: 5,            // Sua concorrência
        iterationCount: 20,              // Quantas vezes testar
        delayBetweenMs: 200             // Espera entre
    };

    const result = await performStressTest(config);
    printStressTestResults(result);

    // Suas assertions
    expect(result.summary.successRate).toBeGreaterThan(90);
});
```

---

## 📝 Interpretando Seu Padrão

Com base nos resultados dos testes, você pode:

1. **Identificar limite real de payload**
   - "STRESS-010" mostra exatamente até quantos MB funciona

2. **Encontrar causa de timeout**
   - "STRESS-003" reproduz exatamente o erro que você vê

3. **Validar solução**
   - Depois de otimizar, execute "STRESS-006" novamente

4. **Documentar limites**
   - Salve resultado para referência futura

---

## 🚀 Próximas Etapas

1. **Execute os testes:**
   ```bash
   npm test -- sync-stress.test.ts
   ```

2. **Procure pelo padrão de erro que você vê:**
   - TIMEOUT = payload grande
   - VALIDATION_ERROR = muitos shards
   - NETWORK_ERROR = conexão instável

3. **Leia a recomendação:**
   - Sistema dirá exatamente o que fazer

4. **Ajuste sua app:**
   - Reduza payload, shards, ou ambos

5. **Re-teste para validar:**
   ```bash
   npm test -- sync-stress.test.ts -t "STRESS-006"
   ```

---

## 📚 Documentação Relacionada

- `SOLUCAO_COMPLETA_ERRO_LUA.md` - Solução geral
- `GUIA_DIAGNOSTICO_ERRO_LUA.md` - Funções de debugging
- `ANALISE_PADRAO_ERRO_ESPECIFICO.md` - Seu padrão específico

---

Pronto para estressar o sistema e descobrir o limite exato! 🧪🚀
