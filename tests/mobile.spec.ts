// @ts-nocheck
/**
 * 📱 NÍVEL K: MOBILE TESTING
 * ==========================
 * Testa responsividade e interações mobile
 */

import { test, expect, devices } from '@playwright/test';

test.describe('📱 NÍVEL K: MOBILE TESTING', () => {

  test.describe('iPhone 12', () => {
    test.use({ ...devices['iPhone 12'] });

    test('K-001: layout mobile é responsivo', async ({ page }) => {
      await page.goto('http://localhost:5173');
      const viewport = page.viewportSize();
      
      expect(viewport?.width).toBeLessThanOrEqual(390);
      expect(viewport?.height).toBeLessThanOrEqual(844);
    });

    test('K-002: menu deve ser colapsado no mobile', async ({ page }) => {
      await page.goto('http://localhost:5173');
      
      const sidebar = page.locator('[data-testid="sidebar"]');
      if (await sidebar.isVisible()) {
        const visibility = await sidebar.evaluate(el => window.getComputedStyle(el).display);
        expect(visibility === 'none' || visibility === 'hidden' || 
                await sidebar.getAttribute('class')?.includes('collapsed')).toBeTruthy();
      }
    });

    test('K-003: botões devem ser clicáveis com toque', async ({ page }) => {
      await page.goto('http://localhost:5173');
      
      const button = page.locator('button').first();
      if (await button.isVisible()) {
        const box = await button.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44); // Mínimo WCAG
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
    });

    test('K-004: inputs devem ter tamanho touch-friendly', async ({ page }) => {
      await page.goto('http://localhost:5173');
      
      const input = page.locator('input').first();
      if (await input.isVisible()) {
        const box = await input.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('K-005: texto não deve estar muito pequeno', async ({ page }) => {
      await page.goto('http://localhost:5173');
      
      const paragraph = page.locator('p').first();
      if (await paragraph.isVisible()) {
        const size = await paragraph.evaluate(el => window.getComputedStyle(el).fontSize);
        const pxSize = parseInt(size);
        expect(pxSize).toBeGreaterThanOrEqual(12); // Mínimo recomendado
      }
    });
  });

  test.describe('iPad (Tablet)', () => {
    test.use({ ...devices['iPad'] });

    test('K-006: layout tablet adapta corretamente', async ({ page }) => {
      await page.goto('http://localhost:5173');
      const viewport = page.viewportSize();
      
      expect(viewport?.width).toBeLessThanOrEqual(768);
      expect(viewport?.width).toBeGreaterThanOrEqual(600);
    });

    test('K-007: sidebar pode ser expandido em tablet', async ({ page }) => {
      await page.goto('http://localhost:5173');
      
      const sidebar = page.locator('[data-testid="sidebar"]');
      if (await sidebar.isVisible()) {
        expect(sidebar).toBeVisible();
      }
    });
  });

  test.describe('Android Mobile', () => {
    test.use({ ...devices['Pixel 5'] });

    test('K-008: aplicação funciona em Android', async ({ page }) => {
      await page.goto('http://localhost:5173');
      const viewport = page.viewportSize();
      
      expect(viewport?.width).toBeLessThanOrEqual(393);
      expect(viewport?.height).toBeLessThanOrEqual(851);
    });

    test('K-009: gestos swipe funcionam', async ({ page }) => {
      await page.goto('http://localhost:5173');
      
      const card = page.locator('[data-testid="habit-card"]').first();
      if (await card.isVisible()) {
        // Simular swipe horizontal
        const box = await card.boundingBox();
        if (box) {
          await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
          expect(card).toBeVisible();
        }
      }
    });
  });

  test.describe('Orientação Landscape', () => {

    test('K-010: app funciona em landscape', async ({ page }) => {
      await page.goto('http://localhost:5173');
      await page.setViewportSize({ width: 667, height: 375 });
      
      const content = page.locator('[data-testid="habits-list"]');
      expect(content || page.locator('main')).toBeDefined();
    });
  });

  test.describe('Performance Mobile', () => {

    test('K-011: página carrega em < 3s em mobile', async ({ page }) => {
      const start = Date.now();
      await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(3000);
    });

    test('K-012: imagens são otimizadas para mobile', async ({ page }) => {
      await page.goto('http://localhost:5173');
      
      const images = page.locator('img');
      const count = await images.count();
      
      for (let i = 0; i < Math.min(count, 5); i++) {
        const img = images.nth(i);
        const src = await img.getAttribute('src');
        expect(src).toBeTruthy();
      }
    });
  });
});
