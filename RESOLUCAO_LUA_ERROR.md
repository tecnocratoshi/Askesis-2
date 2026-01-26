# 🔧 Resolução de Erro: "Lua Execution Error" na Sincronização

## 📋 Problema Identificado

Após sincronização, o erro `"Falha no envio: Lua Execution Error"` ocorre quando:

1. **JSON mal-formatado** é enviado ao script Lua no servidor
2. **Dados criptografados** contêm caracteres especiais não escapados
3. **Validação insuficiente** do payload no cliente
4. **Payload muito grande** (> 10MB)

---

## 🔍 Como o Erro Ocorre

### Fluxo Original (Problemático)

```
Cliente
  ↓ encripta shards
  ↓ JSON.stringify(payload) ❌ (sem validação)
Servidor (/api/sync)
  ↓ kv.eval(LUA_SHARDED_UPDATE)
  ↓ cjson.decode(shardsJson) ❌ JSON inválido!
  ↓ return { "ERROR", "Invalid JSON in shards" }
Cliente
  ↓ error: "Lua Execution Error" 😞
```

---

## ✅ Melhorias Implementadas

### 1. **Validação Aprimorada do Script Lua** (`/api/sync.ts`)

```lua
-- Agora retorna erros ESPECÍFICOS:
"JSON_PARSE_ERROR:..." 
"INVALID_SHARDS_TYPE:..."
"SHARD_NOT_STRING:..."
"TOO_MANY_SHARDS:..."
```

**Antes:** `"Invalid JSON in shards"` (genérico)  
**Depois:** `"JSON_PARSE_ERROR: unexpected character at line 1, col 5"` (específico)

### 2. **Validação no Cliente** (`/services/cloud.ts`)

```typescript
// ✅ Agora valida:
- Resultado da criptografia (não pode ser undefined)
- Tamanho do payload (máx 10MB)
- Serialização JSON antes de enviar
- Parsing de resposta com fallback

if (!encrypted || typeof encrypted !== 'string') {
    throw new Error(`Encryption failed for shard ${shardName}`);
}

if (payloadStr.length > 10 * 1024 * 1024) {
    throw new Error(`Payload too large: ${size}MB`);
}
```

### 3. **Melhor Tratamento de Erros na API**

```typescript
// Captura erros específicos do Lua com contexto
try {
    result = await kv.eval(LUA_SHARDED_UPDATE, [...]);
} catch (luaError: any) {
    console.error("Lua execution error:", luaError);
    return Response({ error: `Lua execution failed: ${luaError.message}` });
}
```

### 4. **Logging Detalhado no Cliente**

```typescript
console.error("[Sync] Error details:", { 
    message: errorMsg, 
    stack: error.stack,
    timestamp: new Date().toISOString()
});
```

---

## 🧪 Testes Adicionados

Novo arquivo: [sync-validation.test.ts](sync-validation.test.ts)

Valida:
- ✅ Serialização correta de shards
- ✅ Detecção de tipos inválidos
- ✅ Limite de tamanho (10MB)
- ✅ Hash para detecção de mudanças
- ✅ Preservação de dados após serialização

---

## 🚀 Como Evitar o Erro Daqui em Diante

### Para Desenvolvedores

1. **Sempre validar payload antes de enviar:**
   ```typescript
   const payload = { lastModified, shards };
   const str = JSON.stringify(payload); // Valida JSON
   if (str.length > 10_000_000) throw new Error('Too large');
   ```

2. **Adicionar try-catch específicos:**
   ```typescript
   try {
       const encrypted = await runWorkerTask<string>('encrypt', data, key);
       if (!encrypted) throw new Error('Encryption returned empty');
   } catch (e) {
       addSyncLog(`Encryption failed: ${e.message}`, "error");
   }
   ```

3. **Testar com payloads grandes:**
   ```typescript
   // Simular dados reais com muitos hábitos
   const largeState = generateLargeState(1000); // 1000 hábitos
   await syncStateWithCloud(largeState);
   ```

### Para Usuários

1. **Se receber este erro:**
   - Verifique se está usando muitos hábitos/dados (> 100 hábitos)
   - Tente sincronizar novamente (debounce de 2s)
   - Limpe cache do navegador se persistir

2. **Monitore via console do navegador:**
   ```javascript
   // Abra DevTools (F12) e veja os logs:
   // [Sync] Error details: { message: "...", stack: "...", timestamp: "..." }
   ```

---

## 📊 Comparação: Antes vs Depois

| Aspecto | Antes | Depois |
|---------|-------|--------|
| **Mensagem de Erro** | "Lua Execution Error" | "JSON_PARSE_ERROR: ..." |
| **Validação Cliente** | ❌ Nenhuma | ✅ Completa |
| **Validação Lua** | ⚠️ Básica | ✅ Detalhada (5 tipos) |
| **Logging** | ❌ Nenhum | ✅ Completo com timestamp |
| **Limite Payload** | ❌ Sem limite | ✅ 10MB |
| **Testes** | ⚠️ Não testado | ✅ Nova suite adicionada |

---

## 🔗 Arquivos Modificados

1. [/api/sync.ts](../api/sync.ts) - Script Lua e validação de servidor
2. [/services/cloud.ts](../services/cloud.ts) - Validação de cliente e logging
3. [/services/sync-validation.test.ts](./sync-validation.test.ts) - Novos testes

---

## 📞 Próximas Etapas

- [ ] Monitorar erros em produção
- [ ] Implementar retry automático com backoff exponencial
- [ ] Adicionar telemetria de tamanho de payload
- [ ] Considerar compressão gzip para payloads > 5MB
