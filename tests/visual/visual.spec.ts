// @ts-nocheck
/**
 * 🎨 NÍVEL G: VISUAL REGRESSION TESTING
 * =====================================
 * 
 * Detecta mudanças visuais indesejadas na interface
 * usando snapshots de screenshots
 */

import { test, expect } from '@playwright/test';

test.describe('🎨 Nível G: Visual Regression', () => {

  test.beforeEach(async ({ page }) => {
    // Definir viewport padrão para consistência
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('G-001: Home page snapshot', async ({ page }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await expect(page).toHaveScreenshot('home-page.png', { 
      maxDiffPixels: 100,
      threshold: 0.2 
    });
  });

  test('G-002: Habit cards layout', async ({ page }) => {
    await page.goto('http://localhost:5173');
    const habitGrid = page.locator('[data-testid="habit-grid"]');
    
    if (await habitGrid.isVisible()) {
      await expect(habitGrid).toHaveScreenshot('habit-grid.png');
    }
  });

  test('G-003: Modal novo hábito', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const newHabitBtn = page.locator('[data-testid="new-habit-btn"]');
    if (await newHabitBtn.isVisible()) {
      await newHabitBtn.click();
      
      const modal = page.locator('[data-testid="new-habit-modal"]');
      await modal.waitFor({ state: 'visible' });
      
      await expect(modal).toHaveScreenshot('new-habit-modal.png');
    }
  });

  test('G-004: Analytics/Charts', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const analyticsBtn = page.locator('[data-testid="analytics-btn"]');
    if (await analyticsBtn.isVisible()) {
      await analyticsBtn.click();
      
      const chart = page.locator('canvas').first();
      await chart.waitFor({ state: 'visible' });
      
      // Aguardar renderização do gráfico
      await page.waitForTimeout(1000);
      
      await expect(chart.locator('..').first()).toHaveScreenshot('analytics-chart.png');
    }
  });

  test('G-005: Sidebar/Navigation', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const sidebar = page.locator('[data-testid="sidebar"]');
    if (await sidebar.isVisible()) {
      await expect(sidebar).toHaveScreenshot('sidebar.png');
    }
  });

  test('G-006: Theme light mode', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    // Garantir light mode
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    
    await expect(page).toHaveScreenshot('theme-light.png');
  });

  test('G-007: Theme dark mode', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    // Garantir dark mode
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    
    await expect(page).toHaveScreenshot('theme-dark.png');
  });

  test('G-008: Error state visual', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    // Simular erro injetando classe
    await page.evaluate(() => {
      const element = document.querySelector('[data-testid="main"]');
      if (element) element.classList.add('error-state');
    });
    
    await expect(page).toHaveScreenshot('error-state.png', { 
      maxDiffPixels: 500 
    });
  });

  test('G-009: Loading skeleton visual', async ({ page }) => {
    // Página com data-loading attribute
    await page.goto('http://localhost:5173');
    
    // Simular loading
    await page.evaluate(() => {
      document.querySelector('[data-testid="main"]')?.setAttribute('data-loading', 'true');
    });
    
    await expect(page).toHaveScreenshot('loading-skeleton.png');
  });

  test('G-010: Responsive mobile view (360px)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('http://localhost:5173');
    
    await expect(page).toHaveScreenshot('mobile-360.png');
  });

});
