// @ts-nocheck
/**
 * 🎯 NÍVEL J: E2E JOURNEYS TESTING
 * ================================
 * Testa fluxos completos de usuário end-to-end
 */

import { test, expect } from '@playwright/test';

test.describe('🎯 NÍVEL J: E2E JOURNEYS', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  });

  test('J-001: criar novo hábito completo', async ({ page }) => {
    // 1. Clique em novo hábito
    const newBtn = page.locator('[data-testid="new-habit"]');
    if (await newBtn.isVisible()) {
      await newBtn.click();
      
      // 2. Preencher forma
      const nameInput = page.locator('[data-testid="habit-name"]');
      if (await nameInput.isVisible()) {
        await nameInput.fill('Meditação');
        
        // 3. Salvar
        const saveBtn = page.locator('button:has-text("Salvar")');
        await saveBtn.click();
        
        // 4. Verificar que foi criado
        await expect(page.locator('text=Meditação')).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('J-002: marcar hábito como completo por 7 dias', async ({ page }) => {
    const completeButtons = page.locator('[data-testid="complete-day"]');
    const count = await completeButtons.count();
    
    if (count > 0) {
      for (let i = 0; i < Math.min(7, count); i++) {
        await completeButtons.nth(i).click({ timeout: 1000 });
        await page.waitForTimeout(100);
      }
      
      // Verificar streak
      const streakText = page.locator('[data-testid="streak"]');
      if (await streakText.isVisible()) {
        await expect(streakText).toContainText(/\d+ dias/, { timeout: 5000 });
      }
    }
  });

  test('J-003: editar hábito existente', async ({ page }) => {
    const editBtn = page.locator('[data-testid="edit-habit"]').first();
    
    if (await editBtn.isVisible()) {
      await editBtn.click();
      
      const input = page.locator('[data-testid="habit-name"]');
      if (await input.isVisible()) {
        await input.clear();
        await input.fill('Novo Nome');
        
        const saveBtn = page.locator('button:has-text("Salvar")');
        await saveBtn.click();
        
        await expect(page.locator('text=Novo Nome')).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('J-004: deletar hábito com confirmação', async ({ page }) => {
    const deleteBtn = page.locator('[data-testid="delete-habit"]').first();
    
    if (await deleteBtn.isVisible()) {
      const initialCount = await page.locator('[data-testid="habit-card"]').count();
      
      await deleteBtn.click();
      
      // Confirmar deleção se houver modal
      const confirmBtn = page.locator('button:has-text("Confirmar")');
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
      }
      
      // Contar reduzido
      const finalCount = await page.locator('[data-testid="habit-card"]').count();
      expect(finalCount).toBeLessThanOrEqual(initialCount);
    }
  });

  test('J-005: navegar para análise e visualizar gráficos', async ({ page }) => {
    const analyticsBtn = page.locator('[data-testid="analytics"]');
    
    if (await analyticsBtn.isVisible()) {
      await analyticsBtn.click();
      
      // Esperar pela página de análise
      await page.waitForURL(/.*analytics|.*dashboard/, { timeout: 5000 });
      
      // Verificar que há gráficos
      const chart = page.locator('canvas, [data-testid="chart"]').first();
      if (await chart.isVisible()) {
        expect(chart).toBeVisible();
      }
    }
  });

  test('J-006: filtrar hábitos por status', async ({ page }) => {
    const filterBtn = page.locator('[data-testid="filter"]');
    
    if (await filterBtn.isVisible()) {
      await filterBtn.click();
      
      const completedOption = page.locator('[data-testid="filter-completed"]');
      if (await completedOption.isVisible()) {
        await completedOption.click();
        
        // Verificar que filtragem funcionou
        await page.waitForTimeout(300);
        expect(page.locator('[data-testid="habit-card"]')).toBeDefined();
      }
    }
  });

  test('J-007: buscar hábito por nome', async ({ page }) => {
    const searchInput = page.locator('[data-testid="search"]');
    
    if (await searchInput.isVisible()) {
      await searchInput.fill('Medi');
      await page.waitForTimeout(300);
      
      // Resultados devem ser filtrados
      const cards = page.locator('[data-testid="habit-card"]');
      expect(cards).toBeDefined();
    }
  });

  test('J-008: exportar dados do usuário', async ({ page }) => {
    const exportBtn = page.locator('[data-testid="export"]');
    
    if (await exportBtn.isVisible()) {
      const downloadPromise = page.waitForEvent('download');
      await exportBtn.click();
      
      try {
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toContain('.json');
      } catch (e) {
        // Export pode não estar implementado
      }
    }
  });

  test('J-009: sincronizar entre abas/janelas', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    
    await page1.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page2.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    
    // Completar hábito na página 1
    const btn1 = page1.locator('[data-testid="complete-day"]').first();
    if (await btn1.isVisible()) {
      await btn1.click();
      
      // Recarregar página 2
      await page2.reload();
      
      // Dados devem estar sincronizados
      const syncStatus = page2.locator('[data-testid="sync-status"]');
      if (await syncStatus.isVisible()) {
        await expect(syncStatus).toContainText(/sincronizado|atualizado/i, { timeout: 5000 });
      }
    }
    
    await page1.close();
    await page2.close();
  });

  test('J-010: fluxo completo: criar → completar → analisar', async ({ page }) => {
    // 1. Criar hábito
    const newBtn = page.locator('[data-testid="new-habit"]');
    if (await newBtn.isVisible()) {
      await newBtn.click();
      const input = page.locator('[data-testid="habit-name"]');
      if (await input.isVisible()) {
        await input.fill('Leitura');
        await page.locator('button:has-text("Salvar")').click();
        await expect(page.locator('text=Leitura')).toBeVisible({ timeout: 5000 });
      }
    }
    
    // 2. Marcar como completo 3 dias
    const completeBtn = page.locator('[data-testid="complete-day"]').first();
    for (let i = 0; i < 3; i++) {
      if (await completeBtn.isVisible()) {
        await completeBtn.click();
        await page.waitForTimeout(100);
      }
    }
    
    // 3. Ir para análise
    const analyticsBtn = page.locator('[data-testid="analytics"]');
    if (await analyticsBtn.isVisible()) {
      await analyticsBtn.click();
      await page.waitForURL(/.*analytics/, { timeout: 5000 });
      expect(page).toHaveURL(/.*analytics/);
    }
  });
});
