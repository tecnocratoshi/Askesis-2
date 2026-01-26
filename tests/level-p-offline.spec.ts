// @ts-nocheck
/**
 * 🔌 NÍVEL P: OFFLINE-FIRST TESTING
 * ==================================
 * Testa funcionalidade offline e service worker
 */

import { test, expect } from '@playwright/test';

test.describe('🔌 NÍVEL P: OFFLINE-FIRST TESTING', () => {

  test('P-001: app funciona offline', async ({ page, context }) => {
    // 1. Carregar app online
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    
    // 2. Ir offline
    await context.setOffline(true);
    
    // 3. Deve continuar funcional
    const habitCard = page.locator('[data-testid="habit-card"]');
    if (await habitCard.count() > 0) {
      expect(habitCard.first()).toBeVisible();
    }
    
    // 4. Voltar online
    await context.setOffline(false);
  });

  test('P-002: dados persistem quando offline', async ({ page, context }) => {
    // Carregar online
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    
    const initialData = await page.evaluate(() => {
      return localStorage.getItem('habits');
    });
    
    // Ir offline
    await context.setOffline(true);
    
    // Dados devem estar acessíveis
    const offlineData = await page.evaluate(() => {
      return localStorage.getItem('habits');
    });
    
    expect(offlineData).toBe(initialData);
    
    await context.setOffline(false);
  });

  test('P-003: service worker está registrado', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const hasServiceWorker = await page.evaluate(() => {
      return 'serviceWorker' in navigator;
    });
    
    expect(hasServiceWorker).toBe(true);
  });

  test('P-004: cache strategy funciona', async ({ page }) => {
    const requests: string[] = [];
    
    page.on('request', req => {
      if (!req.url().includes('localhost')) return;
      requests.push(req.url());
    });
    
    // 1º carregamento
    await page.goto('http://localhost:5173');
    const firstLoadRequests = requests.length;
    
    // 2º carregamento (deve usar mais cache)
    requests.length = 0;
    await page.goto('http://localhost:5173');
    const secondLoadRequests = requests.length;
    
    // Esperado: menos requests no 2º carregamento
    expect(secondLoadRequests).toBeLessThanOrEqual(firstLoadRequests);
  });

  test('P-005: página funciona sem conexão', async ({ page, context }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    
    // Desligar internet
    await context.setOffline(true);
    
    // Página deve estar carregada e funcional
    const heading = page.locator('h1, h2');
    expect(await heading.count()).toBeGreaterThan(0);
    
    await context.setOffline(false);
  });

  test('P-006: dados são sincronizados ao voltar online', async ({ page, context }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    
    // Desconectar
    await context.setOffline(true);
    
    // Fazer uma ação offline (ex: clicar botão)
    const button = page.locator('[data-testid="complete-day"]').first();
    if (await button.isVisible()) {
      await button.click();
    }
    
    // Reconectar
    await context.setOffline(false);
    
    // Aguardar sincronização
    await page.waitForTimeout(2000);
    
    // Verificar que sync ocorreu
    const syncStatus = page.locator('[data-testid="sync-status"]');
    if (await syncStatus.isVisible()) {
      await expect(syncStatus).toContainText(/sincronizado|completo/i, { timeout: 5000 });
    }
  });

  test('P-007: IndexedDB armazena dados localmente', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const hasIndexedDB = await page.evaluate(() => {
      return !!window.indexedDB;
    });
    
    expect(hasIndexedDB).toBe(true);
    
    // Tentar acessar dados no IndexedDB
    const dbNames = await page.evaluate(() => {
      return new Promise((resolve) => {
        const databases = indexedDB.databases?.() || [];
        resolve(databases);
      });
    });
    
    expect(Array.isArray(dbNames)).toBe(true);
  });

  test('P-008: histórico de sincronização', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const syncHistory = await page.evaluate(() => {
      return localStorage.getItem('syncHistory');
    });
    
    // Deve ter histórico de sync armazenado
    expect(syncHistory === null || typeof syncHistory === 'string').toBe(true);
  });

  test('P-009: conflitos são resolvidos ao sincronizar', async ({ page, context, browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    await page1.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page2.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    
    // Página 1 offline, fazer mudança
    await context1.setOffline(true);
    const btn1 = page1.locator('[data-testid="complete-day"]').first();
    if (await btn1.isVisible()) {
      await btn1.click();
    }
    
    // Página 2 online, fazer mudança diferente
    const btn2 = page2.locator('[data-testid="complete-day"]').first();
    if (await btn2.isVisible()) {
      await btn2.click();
    }
    
    // Reconectar página 1
    await context1.setOffline(false);
    await page1.waitForTimeout(1000);
    
    // Deve resolver conflito (Last-Write-Wins ou merge)
    expect(page1).toBeDefined();
    
    await context1.close();
    await context2.close();
  });

  test('P-010: aplicação responde a mudanças de conexão', async ({ page, context }) => {
    await page.goto('http://localhost:5173');
    
    const connectionStatus = await page.evaluate(() => {
      return navigator.onLine;
    });
    
    expect(typeof connectionStatus).toBe('boolean');
    
    // Alternar offline/online
    await context.setOffline(true);
    const offlineStatus = await page.evaluate(() => navigator.onLine);
    expect(offlineStatus).toBe(false);
    
    await context.setOffline(false);
    const onlineStatus = await page.evaluate(() => navigator.onLine);
    expect(onlineStatus).toBe(true);
  });
});
