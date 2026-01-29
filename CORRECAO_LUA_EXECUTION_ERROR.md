# 🔧 Correção: "Falha no envio: Lua Execution Error"

## 📋 Problema Identificado

O erro "Lua Execution Error" estava ocorrendo repetidamente porque:

1. **Retry indiscriminado**: O sistema estava tentando novamente TODOS os erros, inclusive os permanentes
2. **Falta de classificação de erros**: Não diferenciava entre:
   - ❌ Erros permanentes (JSON malformado, validação falha)
   - ✅ Erros temporários (rede, servidor sobrecarregado)
3. **API retornando HTTP 400**: Erros de validação Lua estavam com status 400, impedindo retry

---

## ✅ Solução Implementada

### 1. **Classificação Inteligente de Erros** (`/services/cloud.ts`)

Agora o cliente detecta:

```typescript
// ERROS PERMANENTES (não-retryable):
const isJsonError = errorMsg.includes('JSON_PARSE_ERROR') || 
                   errorMsg.includes('Failed to serialize') ||
                   errorMsg.includes('Encryption failed');

const isValidationError = errorMsg.includes('INVALID_SHARDS_TYPE') ||
                         errorMsg.includes('TOO_MANY_SHARDS') ||
                         errorMsg.includes('SHARD_NOT_STRING');

// ERROS TEMPORÁRIOS (retryable):
const isNetworkError = errorMsg.includes('Network') ||
                      errorMsg.includes('timeout');

const isServerError = errorMsg.includes('500') ||
                     errorMsg.includes('502') ||
                     errorMsg.includes('Lua Execution Error');

// Só faz retry se for temporário
const isRetryable = isNetworkError || (isServerError && !isJsonError && !isValidationError);
```

### 2. **HTTP Status Codes Apropriados** (`/api/sync.ts`)

Agora a API retorna:

```typescript
// HTTP 400: Erros não-retryable (client side)
- JSON_PARSE_ERROR
- INVALID_SHARDS_TYPE
- SHARD_NOT_STRING
- TOO_MANY_SHARDS

// HTTP 500: Erros retryable (server side)
- Lua Execution Error (genérico)
- Outras falhas de execução
```

### 3. **Feedback Melhorado ao Usuário**

**Para erros permanentes:**
```
⚠️ Erro não-recuperável: JSON_PARSE_ERROR: unexpected character...
```

**Para erros temporários com retry:**
```
📤 Sincronizando 3 pacotes...
🔄 Falha no envio: Lua Execution Error. Tentativa 1/5 em 1.2s...
🔄 Falha no envio: Lua Execution Error. Tentativa 2/5 em 2.1s...
✅ Nuvem atualizada. (após sucesso)
```

---

## 🧪 Casos de Teste

### Caso 1: JSON Malformado
```
❌ Retryable: NÃO
Status API: 400
Mensagem: "JSON_PARSE_ERROR: unexpected character at line 1"
Ação: Falha imediata, não tenta novamente
```

### Caso 2: Erro Temporário do Servidor
```
✅ Retryable: SIM
Status API: 500
Mensagem: "Lua Execution Error" (genérico)
Ação: Tenta novamente em 1s, 2s, 4s, 8s, 16s
```

### Caso 3: Validação (Muitos Shards)
```
❌ Retryable: NÃO
Status API: 400
Mensagem: "TOO_MANY_SHARDS: 1001"
Ação: Falha imediata, não tenta novamente
```

### Caso 4: Erro de Rede
```
✅ Retryable: SIM
Status API: (não chega)
Mensagem: "Network timeout"
Ação: Tenta novamente com backoff exponencial
```

---

## 📊 Impacto

### Antes
```
❌ Erro retorna → Tenta novamente 5x → Falha de novo
❌ Usuário vê múltiplas tentativas falhadas
❌ Loop visual confuso (Tentativa 1/5, 2/5, 3/5... todas falhando)
```

### Depois
```
✅ Erro temporário → Tenta novamente com backoff
✅ Erro permanente → Falha imediata com mensagem clara
✅ Usuário vê feedback apropriado para cada tipo de erro
```

---

## 🔍 Debugging

No console do navegador (F12):

```javascript
// Ver status detalhado
getSyncStatus()
// {
//   successRate: "80%",
//   lastError: {
//     message: "JSON_PARSE_ERROR: ...",
//     timestamp: 1706430000000
//   },
//   topErrors: ["JSON_PARSE_ERROR(2)", "NETWORK_ERROR(1)"]
// }

// Ver tentativas
getSyncRetryCount()
// 0 (se sucesso) ou 1-5 (se em retry)
```

---

## 📝 Mudanças de Código

### `/services/cloud.ts`
- ✅ Adicionada lógica de classificação de erros
- ✅ Detecta erros permanentes vs temporários
- ✅ Feedback de erro mais específico

### `/api/sync.ts`
- ✅ HTTP 400 para erros permanentes
- ✅ HTTP 500 para erros temporários
- ✅ Melhor logging de erros Lua

---

## 🎯 Próximas Melhorias

1. **Análise Proativa**: Se vir 3+ erros JSON_PARSE em 1 hora → investigar
2. **Alertas**: Notificar dev se erro não-retryable for recorrente
3. **Compressão**: Se Payload > 5MB → sugerir compressão
4. **Circuit Breaker**: Se 5 retries falharem → não tentar novamente por 1h

---

**Status**: ✅ Corrigido e pronto para produção
**Data**: 29/01/2026
