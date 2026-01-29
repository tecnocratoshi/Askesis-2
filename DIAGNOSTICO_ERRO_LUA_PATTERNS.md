# 🔍 Diagnóstico Completo: Padrão de "Lua Execution Error" Recorrente

## 📊 Situação Atual Identificada

O erro "Falha no envio: Lua Execution Error" continua aparecendo **mesmo com sincronização bem-sucedida** porque:

### 1. **Mensagem Genérica Mascarando o Real Problema**

O fluxo atual captura:
```typescript
// Em /api/sync.ts (linha 129)
} catch (luaError: any) {
    console.error("Lua execution error:", luaError);
    return new Response(JSON.stringify({ 
        error: `Lua execution failed: ${luaError.message}` 
    }), { status: 500 });
}
```

**Problema:** O `luaError.message` é frequentemente genérico da biblioteca `@vercel/kv`:
- `"Lua execution failed: timeout"`
- `"Lua execution failed: script error"`
- `"Lua execution failed: connection refused"`

### 2. **Retry Acontecendo em Paralelo com Sincronização Bem-sucedida**

```
Timeline problemático:
T0: Cliente envia payload 1 → Servidor processa
T0: Cliente inicia retry (pensa que falhou)
T1: Payload 1 sincroniza com sucesso ✅
T1: Retry com payload 2 falha (Lua error) ⚠️
T2: Cliente mostra erro, mesmo tendo sincronizado
```

### 3. **Classificação de Erros Incompleta**

Atualmente em `/services/cloud.ts` (linha 454):
```typescript
const isServerError = errorMsg.includes('500') ||
                     errorMsg.includes('502') ||
                     errorMsg.includes('503') ||
                     errorMsg.includes('429') ||
                     errorMsg.includes('Lua Execution Error'); // ← SEMPRE retryable!
```

**Problema:** Qualquer erro contendo "Lua Execution Error" é marcado como **retryable**, mesmo se for:
- Erro de sintaxe Lua permanente
- Erro de permissão no Redis
- Erro de timeout de conexão

---

## 🎯 Raiz dos Problemas

### Problema 1: Falta de Context Sobre o Erro Específico
O servidor envia `"Lua execution error"` mas **não especifica qual foi**:
- ❌ Timeout?
- ❌ JSON inválido?
- ❌ Redis indisponível?
- ❌ Script syntax error?

### Problema 2: Retry Indiscriminado
Toda vez que vem um erro "Lua", o sistema tenta 5 vezes. Se falhar 5x, mostra o erro genérico.
**Resultado:** Usuário vê "Lua Execution Error" mesmo tendo sincronizado.

### Problema 3: Falta de Rastreamento do Estado Real
Não há como saber se:
- A sincronização anterior **realmente** foi salva no servidor
- O erro é durante **envio** ou **processamento**
- Um retry está **atualmente em execução**

### Problema 4: Logging Insuficiente no Servidor
`/api/sync.ts` não captura:
- Stack trace completo do erro Lua
- Tamanho real do payload recebido
- Tempo de execução do script Lua
- Qual shard específico causou o erro

---

## 💡 Soluções Propostas

### SOLUÇÃO 1: Melhorar Captura de Erros Lua
**Arquivo:** `/api/sync.ts`

```typescript
try {
    const startTime = Date.now();
    result = await kv.eval(LUA_SHARDED_UPDATE, [dataKey], [String(lastModified), shardsStr]) as [string, any?];
    const duration = Date.now() - startTime;
    
    // Log sucesso com contexto
    console.info("[Sync OK]", {
        durationMs: duration,
        payloadSize: shardsStr.length,
        shardCount: Object.keys(shards).length
    });
    
} catch (luaError: any) {
    const errorDetails = {
        message: luaError.message,
        name: luaError.name,
        code: luaError.code,
        stack: luaError.stack?.split('\n')[0], // Primeira linha do stack
        payloadSize: shardsStr.length,
        shardCount: Object.keys(shards).length,
        timestamp: new Date().toISOString()
    };
    
    console.error("[Sync Lua Error]", errorDetails);
    
    // Classificar o tipo de erro com mais precisão
    const errorType = classifyLuaError(errorDetails);
    
    return new Response(JSON.stringify({ 
        error: errorType.message,
        type: errorType.type,
        details: errorDetails
    }), { 
        status: errorType.statusCode,
        headers: HEADERS_BASE 
    });
}
```

### SOLUÇÃO 2: Função de Classificação de Erros Lua
**Arquivo:** `/api/sync.ts` (nova função)

```typescript
function classifyLuaError(error: any): {
    message: string;
    type: 'TIMEOUT' | 'REDIS_UNAVAILABLE' | 'INVALID_JSON' | 'SCRIPT_ERROR' | 'UNKNOWN';
    statusCode: 400 | 500;
} {
    const msg = error.message?.toLowerCase() || '';
    const code = error.code;
    
    // Timeouts (retryable)
    if (msg.includes('timeout') || msg.includes('timed out') || code === 'ETIMEDOUT') {
        return {
            message: 'TIMEOUT: Script Lua excedeu tempo limite (retryable)',
            type: 'TIMEOUT',
            statusCode: 503  // Service Unavailable (retryable)
        };
    }
    
    // Redis indisponível (retryable)
    if (msg.includes('econnrefused') || msg.includes('enotfound') || code === 'ECONNREFUSED') {
        return {
            message: 'REDIS_UNAVAILABLE: Serviço indisponível (retryable)',
            type: 'REDIS_UNAVAILABLE',
            statusCode: 503
        };
    }
    
    // Erro de sintaxe Lua (não-retryable)
    if (msg.includes('syntax error') || msg.includes('attempt to')) {
        return {
            message: 'SCRIPT_ERROR: Erro no script Lua (código permanente)',
            type: 'SCRIPT_ERROR',
            statusCode: 500  // Keep 500 but it won't be retried
        };
    }
    
    // JSON inválido já foi capturado antes, mas pode vir como Lua error
    if (msg.includes('json') || msg.includes('decode')) {
        return {
            message: 'INVALID_JSON: Payload JSON malformado (não-retryable)',
            type: 'INVALID_JSON',
            statusCode: 400
        };
    }
    
    // Desconhecido
    return {
        message: `UNKNOWN: Erro Lua não classificado: ${msg}`,
        type: 'UNKNOWN',
        statusCode: 500
    };
}
```

### SOLUÇÃO 3: Melhorar Detecção no Cliente
**Arquivo:** `/services/cloud.ts`

```typescript
// Substituir lógica simples por classificação robusta
function classifyError(response: Response, errorMsg: string): {
    isRetryable: boolean;
    reason: string;
    category: string;
} {
    const status = response.status;
    const msg = errorMsg.toLowerCase();
    
    // HTTP 400: Erros permanentes
    if (status === 400) {
        return {
            isRetryable: false,
            reason: 'Cliente enviou dados inválidos',
            category: 'VALIDATION_ERROR'
        };
    }
    
    // HTTP 409: Conflito (não-retryable, precisa merge)
    if (status === 409) {
        return {
            isRetryable: false,
            reason: 'Conflito de versão detectado',
            category: 'CONFLICT'
        };
    }
    
    // HTTP 413: Payload muito grande
    if (status === 413) {
        return {
            isRetryable: false,
            reason: 'Payload excede limite de 10MB',
            category: 'PAYLOAD_TOO_LARGE'
        };
    }
    
    // HTTP 500+: Erros de servidor (potencialmente retryable)
    if (status >= 500) {
        // Mesmo com 500, alguns erros Lua não devem ser retried
        if (msg.includes('script_error') || msg.includes('syntax')) {
            return {
                isRetryable: false,
                reason: 'Erro permanente no script servidor',
                category: 'SCRIPT_ERROR'
            };
        }
        
        // Timeout e indisponibilidade são retryable
        if (msg.includes('timeout') || msg.includes('unavailable')) {
            return {
                isRetryable: true,
                reason: 'Servidor temporariamente indisponível',
                category: 'TEMPORARY_ERROR'
            };
        }
        
        // Lua error genérico: DEPENDE do tipo
        if (msg.includes('lua')) {
            // Se vem com tipo específico na resposta
            const type = extractErrorType(errorMsg);
            if (['TIMEOUT', 'REDIS_UNAVAILABLE'].includes(type)) {
                return {
                    isRetryable: true,
                    reason: `Erro Lua temporário (${type})`,
                    category: type
                };
            }
            return {
                isRetryable: false,
                reason: 'Erro Lua permanente',
                category: 'SCRIPT_ERROR'
            };
        }
    }
    
    // Network error (retryable)
    if (msg.includes('network') || msg.includes('failed to fetch')) {
        return {
            isRetryable: true,
            reason: 'Erro de rede',
            category: 'NETWORK_ERROR'
        };
    }
    
    // Padrão = não retry
    return {
        isRetryable: false,
        reason: 'Erro desconhecido',
        category: 'UNKNOWN'
    };
}

function extractErrorType(errorMsg: string): string {
    const match = errorMsg.match(/(TIMEOUT|REDIS_UNAVAILABLE|SCRIPT_ERROR|INVALID_JSON)/);
    return match ? match[1] : 'UNKNOWN';
}
```

### SOLUÇÃO 4: Rastreamento de Estado de Sincronização
**Arquivo:** `/services/cloud.ts` (adicionar ao telemetry)

```typescript
interface SyncSession {
    id: string;
    startTime: number;
    state: 'pending' | 'sending' | 'processing' | 'completed' | 'failed';
    lastStatus: number | null;
    errorHistory: Array<{
        timestamp: number;
        message: string;
        type: string;
        retryable: boolean;
    }>;
    payloadHash: string;
    attemptCount: number;
}

// Iniciar uma nova sessão
function startSyncSession(appState: AppState): SyncSession {
    const session: SyncSession = {
        id: `sync_${Date.now()}_${Math.random()}`,
        startTime: Date.now(),
        state: 'pending',
        lastStatus: null,
        errorHistory: [],
        payloadHash: hashPayload(appState), // Para detectar se mudou
        attemptCount: 0
    };
    
    syncSessions.set(session.id, session);
    return session;
}

// Registrar erro com contexto
function recordSyncError(sessionId: string, error: any, response?: Response) {
    const session = syncSessions.get(sessionId);
    if (!session) return;
    
    session.errorHistory.push({
        timestamp: Date.now(),
        message: error.message || String(error),
        type: error.type || 'UNKNOWN',
        retryable: error.isRetryable ?? false
    });
    
    session.lastStatus = response?.status ?? null;
}

// Verificar se sincronização foi realmente persistida
async function verifySyncPersisted(sessionId: string): Promise<boolean> {
    const session = syncSessions.get(sessionId);
    if (!session) return false;
    
    try {
        const response = await fetch('/api/sync/verify', {
            method: 'POST',
            body: JSON.stringify({ hash: session.payloadHash })
        });
        return response.ok;
    } catch {
        return false;
    }
}
```

### SOLUÇÃO 5: Endpoint de Verificação
**Arquivo:** `/api/sync.ts` (novo endpoint)

```typescript
// GET /api/sync/verify?hash=abc123
// Verifica se um payload específico foi persistido

export async function handleVerify(req: Request) {
    const url = new URL(req.url);
    const hash = url.searchParams.get('hash');
    
    if (!hash) {
        return new Response(JSON.stringify({ error: 'Missing hash' }), { status: 400 });
    }
    
    try {
        const kv = createClient();
        const stored = await kv.hget(dataKey, 'payloadHashes');
        const hashes = stored ? JSON.parse(stored as string) : {};
        
        const isPersisted = hash in hashes;
        return new Response(JSON.stringify({ 
            persisted: isPersisted,
            timestamp: isPersisted ? hashes[hash] : null
        }), { status: 200 });
    } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
    }
}
```

### SOLUÇÃO 6: Feedback Mais Inteligente ao Usuário
**Arquivo:** `/services/cloud.ts`

```typescript
async function performSync() {
    const session = startSyncSession(appState);
    
    try {
        session.state = 'sending';
        const response = await fetch('/api/sync', { ... });
        session.lastStatus = response.status;
        
        if (response.ok) {
            session.state = 'completed';
            addSyncLog('✅ Sincronização bem-sucedida', 'success');
            recordSyncAttempt(payloadSize, true);
            return;
        }
        
        const error = await response.json();
        const classification = classifyError(response, error.error);
        recordSyncError(session.id, { ...classification, ...error }, response);
        
        if (!classification.isRetryable) {
            // Verificar se sincronização anterior foi persistida
            const wasPersisted = await verifySyncPersisted(session.id);
            
            if (wasPersisted) {
                addSyncLog(
                    `⚠️ Mudança sincronizada previamente. Novo erro: ${classification.reason}`,
                    'info'
                );
            } else {
                addSyncLog(
                    `❌ Erro: ${classification.reason}`,
                    'error'
                );
            }
            session.state = 'failed';
            return;
        }
        
        // Retry logic...
        session.state = 'pending';
        
    } catch (error) {
        recordSyncError(session.id, error);
        // ...
    }
}
```

---

## 📋 Resumo de Mudanças

| Arquivo | Mudança | Benefício |
|---------|---------|-----------|
| `/api/sync.ts` | `classifyLuaError()` | Diagnosticar erro específico (timeout, redis, etc) |
| `/api/sync.ts` | Melhor logging | Identificar padrões de falha |
| `/services/cloud.ts` | `classifyError()` | Diferençar erros retryable vs permanentes |
| `/services/cloud.ts` | `SyncSession` tracking | Rastrear estado real da sincronização |
| `/api/sync.ts` | Endpoint `/verify` | Confirmar se dados foram persistidos |
| UI | Feedback inteligente | Mostrar apenas erros reais ao usuário |

---

## 🧪 Como Testar

```javascript
// No DevTools (F12)

// Ver status detalhado
getSyncStatus()

// Simular erro
triggerSyncError() // função de teste

// Ver histórico de sincronizações
getSyncSessions() // Retorna todas as sessões com histórico de erros

// Verificar se um payload foi persistido
verifySyncPersisted('sync_123456')
```

---

## 🎯 Resultados Esperados

- ✅ Erro "Lua Execution Error" genérico **eliminado**
- ✅ Mensagens como "TIMEOUT: Script excedeu tempo" **específicas**
- ✅ Retry **inteligente** (só quando faz sentido)
- ✅ Usuário **não vê erro** se sincronização foi bem-sucedida
- ✅ Diagnostico rápido de problemas reais em produção
