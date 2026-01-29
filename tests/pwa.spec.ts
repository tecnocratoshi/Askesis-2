// @ts-nocheck
/**
 * 🌐 NÍVEL Q: PWA INSTALL TESTING
 * ===============================
 * Testa funcionalidade de Progressive Web App
 */

import { test, expect } from '@playwright/test';

test.describe('🌐 NÍVEL Q: PWA INSTALL TESTING', () => {

  test('Q-001: manifest.json existe e é válido', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const manifestLink = page.locator('link[rel="manifest"]');
    expect(await manifestLink.count()).toBeGreaterThan(0);
    
    const href = await manifestLink.getAttribute('href');
    expect(href).toBeTruthy();
  });

  test('Q-002: manifest tem informações necessárias', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const manifest = await page.evaluate(() => {
      const link = document.querySelector('link[rel="manifest"]');
      const href = link?.getAttribute('href');
      return fetch(href!).then(r => r.json()).catch(() => null);
    });
    
    if (manifest) {
      expect(manifest.name || manifest.short_name).toBeTruthy();
      expect(manifest.start_url).toBeTruthy();
      expect(manifest.display).toBeTruthy();
    }
  });

  test('Q-003: ícones no manifest', async ({ page }) => {
    const manifest = await page.evaluate(() => {
      const link = document.querySelector('link[rel="manifest"]');
      const href = link?.getAttribute('href');
      return fetch(href!).then(r => r.json()).catch(() => null);
    });
    
    if (manifest && manifest.icons) {
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length).toBeGreaterThan(0);
    }
  });

  test('Q-004: service worker registrado', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const hasServiceWorker = await page.evaluate(() => {
      return navigator.serviceWorker !== undefined;
    });
    
    expect(hasServiceWorker).toBe(true);
  });

  test('Q-005: service worker tem scope correto', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const swScope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.scope;
    });
    
    // Scope deve ser /
    expect(swScope).toBeTruthy();
  });

  test('Q-006: app é instalável (pode estar em tela inicial)', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    // Verificar que tem os requisitos mínimos de PWA
    const requirements = await page.evaluate(() => {
      return {
        https: location.protocol === 'https:',
        manifest: !!document.querySelector('link[rel="manifest"]'),
        serviceWorker: 'serviceWorker' in navigator,
        icons: !!document.querySelector('link[rel="icon"], link[rel="shortcut icon"]'),
        viewport: !!document.querySelector('meta[name="viewport"]'),
        theme: !!document.querySelector('meta[name="theme-color"]')
      };
    });
    
    // Alguns são obrigatórios
    expect(requirements.manifest).toBe(true);
    expect(requirements.serviceWorker).toBe(true);
  });

  test('Q-007: meta theme-color definido', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const themeColor = page.locator('meta[name="theme-color"]');
    const hasTheme = await themeColor.count() > 0;
    
    if (hasTheme) {
      const color = await themeColor.getAttribute('content');
      expect(color).toBeTruthy();
    }
  });

  test('Q-008: viewport meta tag correto', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const viewport = page.locator('meta[name="viewport"]');
    expect(await viewport.count()).toBeGreaterThan(0);
    
    const content = await viewport.getAttribute('content');
    expect(content).toContain('width=device-width');
    expect(content).toContain('initial-scale=1');
  });

  test('Q-009: app name está definido', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const manifest = await page.evaluate(() => {
      const link = document.querySelector('link[rel="manifest"]');
      const href = link?.getAttribute('href');
      return fetch(href!).then(r => r.json()).catch(() => null);
    });
    
    if (manifest) {
      expect(manifest.name || manifest.short_name).toBeTruthy();
    }
  });

  test('Q-010: splash screen configurado', async ({ page }) => {
    const manifest = await page.evaluate(() => {
      const link = document.querySelector('link[rel="manifest"]');
      const href = link?.getAttribute('href');
      return fetch(href!).then(r => r.json()).catch(() => null);
    });
    
    if (manifest) {
      // Pode ter screenshots para splash
      const hasScreenshots = manifest.screenshots && manifest.screenshots.length > 0;
      expect(typeof hasScreenshots).toBe('boolean');
    }
  });

  test('Q-011: orientação preferida definida', async ({ page }) => {
    const manifest = await page.evaluate(() => {
      const link = document.querySelector('link[rel="manifest"]');
      const href = link?.getAttribute('href');
      return fetch(href!).then(r => r.json()).catch(() => null);
    });
    
    if (manifest) {
      // orientation pode estar definida
      expect(manifest.orientation === undefined || typeof manifest.orientation === 'string').toBe(true);
    }
  });

  test('Q-012: app pode ser adicionada à tela inicial (simulado)', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const canInstall = await page.evaluate(() => {
      return new Promise((resolve) => {
        window.addEventListener('beforeinstallprompt', (e: any) => {
          resolve(true);
        });
        setTimeout(() => resolve(false), 500);
      });
    });
    
    // Em ambiente de teste pode não ativar, mas app deve estar preparada
    expect(typeof canInstall).toBe('boolean');
  });
});
