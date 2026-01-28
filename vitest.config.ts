import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Simula um navegador para que 'window', 'document' e 'localStorage' existam
    environment: 'happy-dom',
    // Permite usar describe, it, expect sem importar em cada arquivo
    globals: true,
    // Padrão de busca de arquivos de teste
    include: ['**/*.test.ts'],
    // Limpa mocks automaticamente entre testes para evitar vazamento de estado
    mockReset: true,
  },
});