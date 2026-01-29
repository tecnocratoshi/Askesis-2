# 🔍 Guia Prático: Diagnosticar e Resolver Erros de Lua

## 🚀 Início Rápido

Se você está vendo o erro "Falha no envio: Lua Execution Error", siga estes passos:

### Passo 1: Abra o Console
```
Pressione: F12 (ou Ctrl+Shift+I)
Clique na aba "Console"
```

### Passo 2: Execute o Diagnóstico
```javascript
// Cole isto no console e pressione Enter:
printSyncDiagnostics()
```

Você verá um relatório completo com:
- ✅ Status atual da sincronização
- 📊 Estatísticas de sucesso/falha
- 🔍 Padrão de erros recentes
- 💡 Recomendação automática

---

## 📋 Funções de Debugging Disponíveis

### 1. **Diagnóstico Completo** (Mais detalhado)
```javascript
printSyncDiagnostics()
```
Mostra tudo formatado e colorido no console.

### 2. **Status Rápido**
```javascript
getSyncStatus()
```
Retorna:
```javascript
{
  successRate: "80.5%",
  totalAttempts: 47,
  lastError: {
    message: "TIMEOUT: Script excedeu tempo...",
    timestamp: 1706430000000
  },
  topErrors: [
    "TIMEOUT (4 vezes)",
    "NETWORK_ERROR (2 vezes)"
  ]
}
```

### 3. **Telemetria Completa**
```javascript
getSyncTelemetry()
```
Retorna todos os dados coletados:
```javascript
{
  totalSyncs: 47,
  successfulSyncs: 40,
  failedSyncs: 7,
  errorFrequency: {
    'JSON_PARSE_ERROR': 2,
    'TIMEOUT': 3,
    'NETWORK_ERROR': 2
  },
  lastError: { ... }
}
```

### 4. **Histórico de Logs**
```javascript
getSyncLogs()
```
Mostra últimas mensagens de sincronização com timestamps.

### 5. **Análise de Padrões**
```javascript
analyzeSyncErrors()
```
Retorna padrão de erros e recomendação:
```javascript
{
  totalErrors: 7,
  errorPatterns: {
    TIMEOUT: 4,
    NETWORK_ERROR: 2,
    JSON_PARSE_ERROR: 1
  },
  recommendation: "⚠️ Servidor respondendo lentamente (4x). Sistema tentando automaticamente.",
  lastErrorAt: "2025-01-29T10:30:45.123Z"
}
```

### 6. **Simular Erro (Para Testes)**
```javascript
// Simular erro de timeout
triggerTestSyncError('timeout')

// Simular erro de rede
triggerTestSyncError('network')

// Simular erro de validação
triggerTestSyncError('validation')

// Simular erro Lua genérico
triggerTestSyncError('lua')
```

### 7. **Exportar Diagnóstico Completo**
```javascript
// Copiar para colar em um arquivo/relatório
const diag = exportSyncDiagnostics()
console.log(JSON.stringify(diag, null, 2))
```

### 8. **Resetar Telemetria**
```javascript
resetSyncTelemetry()
```
Limpa todos os dados coletados e começa do zero.

---

## 🎯 Interpretando o Erro "Lua Execution Error"

Agora que o sistema está melhorado, você **não verá mais** essa mensagem genérica.
Ao invés disso, verá uma das seguintes mensagens **específicas**:

### ✅ Erros Retryable (Sistema tenta novamente automaticamente)

| Tipo | Mensagem | O que significa | O que fazer |
|------|----------|-----------------|-----------|
| **TIMEOUT** | "Script excedeu tempo limite" | Servidor lento | Aguarde, retry automático em 1-2s |
| **REDIS_UNAVAILABLE** | "Serviço indisponível" | Redis desconectado temporariamente | Aguarde, sistema tentará novamente |
| **NETWORK_ERROR** | "Erro de conexão" | Conexão de internet instável | Verifique Wi-Fi/dados móveis |
| **SERVER_ERROR** | "Erro no servidor" | Servidor com problemas | Aguarde, será retentado |

### ❌ Erros Não-Retryable (Requer ação do usuário)

| Tipo | Mensagem | O que significa | O que fazer |
|------|----------|-----------------|-----------|
| **INVALID_JSON** | "Dados inválidos" | Payload corrompido | Tente limpar cache (Ctrl+Shift+Delete) |
| **VALIDATION_ERROR** | "Estrutura não suportada" | Dados em formato errado | Sincronize com menos de 100 hábitos |
| **INVALID_DATA** | "Dados não podem ser processados" | Arquivo muito grande | Reduza número de logs/dados armazenados |

---

## 🧪 Exemplo de Diagnóstico Real

### Cenário 1: Erro de Timeout (Recuperável)

**Console mostra:**
```
🔄 Falha no envio: TIMEOUT: Script exceduiu tempo. Tentativa 1/5 em 1.2s...
🔄 Falha no envio: TIMEOUT: Script excedeu tempo. Tentativa 2/5 em 2.1s...
✅ Nuvem atualizada. (após sucesso na tentativa 3)
```

**Diagnóstico:**
```javascript
analyzeSyncErrors()
// {
//   errorPatterns: { TIMEOUT: 2 },
//   recommendation: "⚠️ Servidor respondendo lentamente. Sistema tentando automaticamente."
// }
```

**Ação:** Nenhuma necessária. Sistema recuperou automaticamente ✅

---

### Cenário 2: Erro de Rede (Recuperável)

**Console mostra:**
```
🔄 Falha no envio: Erro de conexão. Tentativa 1/5 em 1.2s...
[Usuário reconecta à WiFi]
✅ Nuvem atualizada. (após sucesso)
```

**Diagnóstico:**
```javascript
getSyncStatus()
// {
//   successRate: "90%",
//   lastError: { message: "NETWORK_ERROR" }
// }
```

**Ação:** Verificar conexão de internet. Sistema tentará novamente.

---

### Cenário 3: Erro de Validação (Não-Recuperável)

**Console mostra:**
```
❌ Erro: Estrutura de dados não suportada
```

**Diagnóstico:**
```javascript
printSyncDiagnostics()
// Mostra:
// ⚠️ Padrão de erro detectado: VALIDATION_ERROR (1x)
// Recomendação: "❌ Erro de estrutura de dados. Sincronize com menos hábitos."
```

**Ação:** 
1. Abra Developer Tools (F12)
2. Execute: `getSyncTelemetry()`
3. Verifique quantos hábitos tem
4. Se > 100 hábitos, delete alguns

---

## 🔧 Soluções Comuns

### Problema: "Falha no envio: Lua..." continua aparecendo

**Solução:**

1. Abra console: F12
2. Execute:
   ```javascript
   analyzeSyncErrors()
   ```
3. Veja qual padrão aparece em `errorPatterns`

**Se TIMEOUT aparece muitas vezes:**
- Sistema de servidor lento
- Tente sincronizar com menos hábitos
- Aguarde alguns minutos

**Se NETWORK_ERROR aparece:**
- Problema de conexão
- Mude para WiFi diferente
- Verifique dados móveis

**Se VALIDATION_ERROR aparece:**
- Dados corrompidos
- Abra DevTools
- Execute: `resetSyncTelemetry()`
- Tente sincronizar novamente

---

### Problema: Sincronização bem-sucedida mas erro ainda mostra

**Verificar se foi realmente sincronizado:**

```javascript
// Ver últimos logs
getSyncLogs()

// Procure por "✅ Nuvem atualizada" antes do erro
// Se encontrou, significa: sincronização OK + retry simultâneo falhou (normal)
```

**Solução:** Nada a fazer, sistema está funcionando corretamente.

---

### Problema: Quero saber exatamente o que está acontecendo

**Solução Completa:**

```javascript
// 1. Ver tudo formatado
printSyncDiagnostics()

// 2. Simular os erros para testar
triggerTestSyncError('lua')
triggerTestSyncError('network')
triggerTestSyncError('validation')

// 3. Exportar para análise
const diagnostico = exportSyncDiagnostics()
// Copiar e guardar para referência
```

---

## 📊 Entendendo a Telemetria

Ao executar `getSyncTelemetry()`, você vê:

```javascript
{
  // Contadores
  totalSyncs: 47,              // Total de tentativas
  successfulSyncs: 40,         // Quantas foram bem-sucedidas
  failedSyncs: 7,              // Quantas falharam

  // Dados de payload
  totalPayloadBytes: 212581,   // Total de dados enviados
  maxPayloadBytes: 8500,       // Maior envio
  avgPayloadBytes: 4523,       // Média por envio

  // Frequência de erros
  errorFrequency: {
    'JSON_PARSE_ERROR': 2,     // Quantas vezes esse erro apareceu
    'TIMEOUT': 3,
    'NETWORK_ERROR': 2
  },

  // Último erro
  lastError: {
    message: "TIMEOUT: Script...",
    timestamp: 1706430000000
  }
}
```

**Taxa de sucesso:**
```javascript
const taxa = (getSyncTelemetry().successfulSyncs / getSyncTelemetry().totalSyncs * 100).toFixed(1)
// Esperado: > 80%
```

---

## 🆘 Se Nada Funcionar

**Colete informações completas:**

```javascript
// Cole isto e copie o resultado completo
console.log(JSON.stringify(exportSyncDiagnostics(), null, 2))
```

**Cole o resultado em:**
- Relatório de bug
- Mensagem para suporte
- Discussão no GitHub

---

## 🚀 Resumo: O Sistema Agora É Inteligente

| Antes | Depois |
|-------|--------|
| ❌ "Lua Execution Error" genérico | ✅ "TIMEOUT: Script excedeu tempo" específico |
| ❌ Sem forma de diagnosticar | ✅ `printSyncDiagnostics()` completo |
| ❌ Sem padrão visível | ✅ `analyzeSyncErrors()` analisa padrões |
| ❌ Retry em tudo | ✅ Retry inteligente só quando faz sentido |
| ❌ Sem logs | ✅ `getSyncLogs()` com histórico completo |

---

## 📞 Próximas Ações

1. **Teste as funções:**
   ```javascript
   printSyncDiagnostics()
   ```

2. **Se erro continuar, execute:**
   ```javascript
   analyzeSyncErrors()
   ```

3. **Se precisar, simule para testar:**
   ```javascript
   triggerTestSyncError('lua')
   ```

4. **Para reportar, use:**
   ```javascript
   exportSyncDiagnostics()
   ```

---

Agora você tem ferramentas para **diagnosticar exatamente** o que está acontecendo com a sincronização! 🎉
