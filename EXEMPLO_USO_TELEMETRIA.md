/**
 * @file EXEMPLO_USO_TELEMETRIA.md
 * @description Guia prático de como usar telemetria e retry de sincronização
 */

# 📊 Exemplo de Uso: Telemetria e Retry de Sincronização

## 1. Verificar Status Atual da Sincronização

### No Console do Navegador:

```javascript
// Abrir DevTools: F12 ou Ctrl+Shift+I

// Ver status em formato legível
getSyncStatus()
```

**Resposta esperada:**
```javascript
{
  successRate: "85.3%",
  totalAttempts: 47,
  lastError: {
    message: "JSON_PARSE_ERROR: unexpected character at line 1",
    timestamp: 1706429861422
  },
  avgPayloadSize: "4523 bytes",
  topErrors: [
    "JSON_PARSE_ERROR(3)",
    "NETWORK_ERROR(1)",
    "HTTP_409(2)"
  ]
}
```

---

## 2. Ver Telemetria Completa

```javascript
// Retorna todos os dados de telemetria
getSyncTelemetry()
```

**Resposta esperada:**
```javascript
{
  totalSyncs: 47,           // Total de tentativas
  successfulSyncs: 40,      // Sucesso
  failedSyncs: 7,           // Falha
  totalPayloadBytes: 212581,     // Total enviado
  maxPayloadBytes: 8500,         // Maior payload
  avgPayloadBytes: 4523,         // Média
  errorFrequency: {
    JSON_PARSE_ERROR: 3,
    NETWORK_ERROR: 1,
    HTTP_409: 2,
    INVALID_SHARDS_TYPE: 1
  },
  lastError: {
    message: "JSON_PARSE_ERROR: ...",
    timestamp: 1706429861422
  }
}
```

---

## 3. Monitorar Tentativas de Retry em Andamento

```javascript
// Quantas tentativas de retry estão em progresso?
getSyncRetryCount()
```

**Respostas possíveis:**
- `0` → Sem retry em andamento (ou último sucesso foi resetado)
- `1` → 1ª tentativa de retry agendada
- `2` → 2ª tentativa de retry agendada
- `3` → 3ª tentativa de retry agendada
- `4` → 4ª tentativa de retry agendada
- `5` → 5ª tentativa de retry agendada (última)

---

## 4. Resetar Telemetria (Para Testes)

```javascript
// Limpar todos os dados de telemetria
resetSyncTelemetry()

// Confirmar reset
getSyncTelemetry()
// Retorna:
// {
//   totalSyncs: 0,
//   successfulSyncs: 0,
//   ...
// }
```

---

## 5. Exemplos de Cenários Reais

### Cenário A: Erro Temporário (Rede)

```javascript
// Situação: Usuário perdeu conexão
// Log esperado na tela:
// 📤 Sincronizando 3 pacotes...
// 🔄 Falha no envio: Network error. Tentativa 1/5 em 1.2s...
// 🔄 Falha no envio: Network error. Tentativa 2/5 em 2.1s...
// ✅ Nuvem atualizada. (conexão recuperada)

getSyncStatus()
// {
//   successRate: "100%",
//   totalAttempts: 3,
//   lastError: null,
//   avgPayloadSize: "5234 bytes",
//   topErrors: ["NETWORK_ERROR(2)"]
// }
```

### Cenário B: Erro Persistente (JSON inválido)

```javascript
// Situação: Payload com JSON mal-formatado
// Log esperado:
// 📤 Sincronizando 2 pacotes...
// 🔄 Falha no envio: JSON_PARSE_ERROR. Tentativa 1/5 em 1.2s...
// 🔄 Falha no envio: JSON_PARSE_ERROR. Tentativa 2/5 em 2.1s...
// 🔄 Falha no envio: JSON_PARSE_ERROR. Tentativa 3/5 em 4.3s...
// 🔄 Falha no envio: JSON_PARSE_ERROR. Tentativa 4/5 em 8.1s...
// 🔄 Falha no envio: JSON_PARSE_ERROR. Tentativa 5/5 em 15.2s...
// ⚠️ Falha após 5 tentativas: JSON_PARSE_ERROR

getSyncStatus()
// {
//   successRate: "0%",
//   totalAttempts: 5,
//   lastError: {
//     message: "JSON_PARSE_ERROR: unexpected character at line 1",
//     timestamp: 1706429861422
//   },
//   avgPayloadSize: "3200 bytes",
//   topErrors: ["JSON_PARSE_ERROR(5)"]
// }
```

### Cenário C: Múltiplos Tipos de Erro

```javascript
// Situação: Mix de erros diferentes (rede, validação, etc)
// Log esperado:
// 📤 Sincronizando 5 pacotes...
// 🔄 Falha no envio: Network error. Tentativa 1/5 em 1.2s...
// 🔄 Falha no envio: Network error. Tentativa 2/5 em 2.1s...
// ✅ Nuvem atualizada. (sucesso)
//
// (30 minutos depois, nova mudança)
//
// 📤 Sincronizando 1 pacote...
// 🔄 Falha no envio: JSON_PARSE_ERROR. Tentativa 1/5 em 1.2s...
// ✅ Nuvem atualizada. (sucesso)

getSyncStatus()
// {
//   successRate: "66.7%",
//   totalAttempts: 3,
//   lastError: {
//     message: "JSON_PARSE_ERROR: ...",
//     timestamp: 1706430500000
//   },
//   avgPayloadSize: "4567 bytes",
//   topErrors: [
//     "NETWORK_ERROR(2)",
//     "JSON_PARSE_ERROR(1)"
//   ]
// }
```

---

## 6. Interpretando os Dados

### Taxa de Sucesso

```javascript
const telemetry = getSyncTelemetry();
const rate = (telemetry.successfulSyncs / telemetry.totalSyncs * 100).toFixed(1);

if (rate > 90) console.log("✅ Sincronização excelente");
if (rate > 70) console.log("⚠️ Sincronização aceitável");
if (rate < 70) console.log("❌ Sincronização com problemas");
```

### Tamanho de Payload

```javascript
const telemetry = getSyncTelemetry();
const avgMB = (telemetry.avgPayloadBytes / 1024 / 1024).toFixed(2);
const maxMB = (telemetry.maxPayloadBytes / 1024 / 1024).toFixed(2);

console.log(`Médio: ${avgMB}MB, Máximo: ${maxMB}MB`);

// ⚠️ Alerta se muito grande
if (telemetry.maxPayloadBytes > 8 * 1024 * 1024) {
    console.warn("Payload próximo do limite (10MB)");
}
```

### Padrão de Erros

```javascript
const telemetry = getSyncTelemetry();
const errors = Object.entries(telemetry.errorFrequency)
    .sort(([, a], [, b]) => b - a);

console.log("Top 3 Erros:");
errors.slice(0, 3).forEach(([type, count]) => {
    console.log(`  ${type}: ${count} vezes`);
});
```

---

## 7. Debugging: Quando Usar a Telemetria

### "Minha sincronização sempre falha"

```javascript
// 1. Verificar tipo de erro
getSyncStatus().topErrors

// 2. Ver último erro detalhado
getSyncTelemetry().lastError

// 3. Contar tentativas feitas
getSyncTelemetry().failedSyncs

// 4. Se JSON_PARSE_ERROR → problema com dados
// 5. Se NETWORK_ERROR → problema de conexão
// 6. Se HTTP_409 → conflito com servidor
```

### "Meu payload é muito grande"

```javascript
// Verificar tamanho
const telemetry = getSyncTelemetry();
console.log(
    `Payload médio: ${(telemetry.avgPayloadBytes / 1024 / 1024).toFixed(2)}MB`
);

// Se > 8MB → considerar compressão no futuro
if (telemetry.maxPayloadBytes > 8 * 1024 * 1024) {
    console.warn("Próximo do limite de 10MB");
}
```

### "Não sei se a sincronização está funcionando"

```javascript
// Status rápido
const status = getSyncStatus();
console.table({
    "Taxa de Sucesso": status.successRate,
    "Total de Tentativas": status.totalAttempts,
    "Último Erro": status.lastError?.message || "Nenhum",
    "Tamanho Médio": status.avgPayloadSize
});
```

---

## 8. Exportar Dados para Análise

```javascript
// Salvar telemetria em JSON
const telemetry = getSyncTelemetry();
const json = JSON.stringify(telemetry, null, 2);

// Copiar para clipboard
copy(json)

// Ou fazer download
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `sync-telemetry-${new Date().toISOString()}.json`;
a.click();
```

---

## 9. Monitoramento em Tempo Real

```javascript
// Verificar status a cada 10 segundos
setInterval(() => {
    const status = getSyncStatus();
    console.log(`[${new Date().toLocaleTimeString()}] Sucesso: ${status.successRate}`);
    
    if (status.lastError) {
        console.warn(`Último erro: ${status.lastError.message}`);
    }
}, 10000);

// Parar monitoramento
// clearInterval(monitorId)
```

---

## 10. Criar Alerta Customizado

```javascript
// Alertar se taxa de sucesso cai
function checkSyncHealth() {
    const status = getSyncStatus();
    const rate = parseFloat(status.successRate);
    
    if (rate < 50) {
        console.error("🚨 ALERTA: Taxa de sucesso crítica!");
        console.error("Detalhes:", status);
        // Enviar para logging service, etc.
    } else if (rate < 80) {
        console.warn("⚠️ Atenção: Taxa de sucesso baixa");
    }
}

// Chamar periodicamente
setInterval(checkSyncHealth, 60000); // A cada minuto
```

---

## Resumo de Funções

| Função | Retorna | Use para |
|--------|---------|----------|
| `getSyncStatus()` | Resumo legível | Status rápido |
| `getSyncTelemetry()` | Dados completos | Análise detalhada |
| `getSyncRetryCount()` | Número | Saber se está retrying |
| `resetSyncTelemetry()` | void | Limpar para testes |

---

## Dicas Finais

1. **Jitter:** Delays têm ±50% de variação (natural, não é bug)
2. **Max 32s:** Delay máximo é sempre 32 segundos entre tentativas
3. **5 tentativas:** Após 5 falhas, marca como erro permanente
4. **Persistência:** Dados ficam em localStorage até resetar
5. **Console:** Logs detalhados aparecem no DevTools (F12)

