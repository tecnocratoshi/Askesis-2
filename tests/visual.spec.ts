// @ts-nocheck
/**
 * 🎨 NÍVEL G: VISUAL REGRESSION TESTING
 * ======================================
 * Detecta mudanças indesejadas na interface usando Playwright
 */

import { test, expect } from '@playwright/test';

test.describe('🎨 NÍVEL G: VISUAL REGRESSION', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  });

  test('G-001: snapshot da página inicial não deve mudar', async ({ page }) => {
    await expect(page).toHaveScreenshot('home-page.png', { maxDiffPixels: 100 });
  });

  test('G-002: snapshot do modal de novo hábito', async ({ page }) => {
    const newHabitBtn = page.locator('[data-testid="new-habit"]');
    if (await newHabitBtn.isVisible()) {
      await newHabitBtn.click();
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot('new-habit-modal.png', { maxDiffPixels: 50 });
    }
  });

  test('G-003: snapshot da tabela de hábitos', async ({ page }) => {
    const habitsTable = page.locator('[data-testid="habits-table"]');
    if (await habitsTable.isVisible()) {
      await expect(habitsTable).toHaveScreenshot('habits-table.png', { maxDiffPixels: 100 });
    }
  });

  test('G-004: snapshot do gráfico de análise', async ({ page }) => {
    const analyticsBtn = page.locator('[data-testid="analytics"]');
    if (await analyticsBtn.isVisible()) {
      await analyticsBtn.click();
      await page.waitForTimeout(500);
      const chart = page.locator('canvas, [data-testid="chart"]').first();
      if (await chart.isVisible()) {
        await expect(chart).toHaveScreenshot('analytics-chart.png', { maxDiffPixels: 150 });
      }
    }
  });

  test('G-005: snapshot em modo responsivo (mobile)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page).toHaveScreenshot('mobile-home.png', { maxDiffPixels: 100 });
  });

  test('G-006: snapshot em modo tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page).toHaveScreenshot('tablet-home.png', { maxDiffPixels: 100 });
  });

  test('G-007: snapshot com tema dark mode', async ({ page }) => {
    // Se houver botão de tema
    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      await page.waitForTimeout(200);
      await expect(page).toHaveScreenshot('home-dark-mode.png', { maxDiffPixels: 100 });
    }
  });

  test('G-008: snapshot com habitação preenchida', async ({ page }) => {
    const habitCards = page.locator('[data-testid="habit-card"]');
    const count = await habitCards.count();
    if (count > 0) {
      await expect(habitCards.first()).toHaveScreenshot('habit-card-filled.png', { maxDiffPixels: 50 });
    }
  });
});
