import { describe, it, expect, beforeEach } from 'vitest';
import { HabitService } from './HabitService';
import { state, HABIT_STATE } from '../state';

// Test Suite para o Núcleo de Dados Binários
describe('HabitService (Bitmasks Core)', () => {
    
    // SETUP: Limpa o estado global antes de cada teste para evitar contaminação
    beforeEach(() => {
        state.monthlyLogs = new Map();
        state.uiDirtyState = { calendarVisuals: false, habitListStructure: false, chartData: false };
        HabitService.resetCache();
    });

    it('deve gravar e ler corretamente um status (DONE)', () => {
        const habitId = 'habit-123';
        const date = '2024-01-01';
        const time = 'Morning';

        // Escrita
        HabitService.setStatus(habitId, date, time, HABIT_STATE.DONE);

        // Leitura
        const status = HabitService.getStatus(habitId, date, time);
        expect(status).toBe(HABIT_STATE.DONE);
    });

    it('deve gravar e ler corretamente um status (DEFERRED)', () => {
        const habitId = 'habit-123';
        const date = '2024-01-01';
        const time = 'Evening';

        HabitService.setStatus(habitId, date, time, HABIT_STATE.DEFERRED);
        expect(HabitService.getStatus(habitId, date, time)).toBe(HABIT_STATE.DEFERRED);
    });

    it('não deve colidir dados de dias diferentes no mesmo mês', () => {
        const habitId = 'habit-123';
        
        // Dia 1: Manhã -> DONE
        HabitService.setStatus(habitId, '2024-01-01', 'Morning', HABIT_STATE.DONE);
        
        // Dia 2: Manhã -> DEFERRED
        HabitService.setStatus(habitId, '2024-01-02', 'Morning', HABIT_STATE.DEFERRED);

        // Verifica integridade
        expect(HabitService.getStatus(habitId, '2024-01-01', 'Morning')).toBe(HABIT_STATE.DONE);
        expect(HabitService.getStatus(habitId, '2024-01-02', 'Morning')).toBe(HABIT_STATE.DEFERRED);
    });

    it('não deve colidir dados de turnos diferentes no mesmo dia', () => {
        const habitId = 'habit-123';
        const date = '2024-01-01';

        HabitService.setStatus(habitId, date, 'Morning', HABIT_STATE.DONE);
        HabitService.setStatus(habitId, date, 'Evening', HABIT_STATE.DONE_PLUS);

        expect(HabitService.getStatus(habitId, date, 'Morning')).toBe(HABIT_STATE.DONE);
        expect(HabitService.getStatus(habitId, date, 'Evening')).toBe(HABIT_STATE.DONE_PLUS);
        // O turno do meio deve estar vazio
        expect(HabitService.getStatus(habitId, date, 'Afternoon')).toBe(HABIT_STATE.NULL);
    });

    it('deve lidar com a lógica de Tombstone (Apagar)', () => {
        const habitId = 'habit-123';
        const date = '2024-01-15';
        
        // 1. Marca como Feito
        HabitService.setStatus(habitId, date, 'Evening', HABIT_STATE.DONE);
        expect(HabitService.getStatus(habitId, date, 'Evening')).toBe(HABIT_STATE.DONE);

        // 2. Apaga (Seta para NULL) - Isso deve ativar o bit de Tombstone
        HabitService.setStatus(habitId, date, 'Evening', HABIT_STATE.NULL);
        
        // 3. Verifica se retornou a 0
        expect(HabitService.getStatus(habitId, date, 'Evening')).toBe(HABIT_STATE.NULL);
    });

    it('deve serializar logs corretamente para a nuvem', () => {
        const habitId = 'h1';
        HabitService.setStatus(habitId, '2024-05-01', 'Morning', HABIT_STATE.DONE);
        
        const serialized = HabitService.serializeLogsForCloud();
        
        // Deve retornar um array de tuplas [key, hexValue]
        expect(serialized.length).toBeGreaterThan(0);
        expect(serialized[0][0]).toContain('h1_2024-05'); // Chave deve conter o mês
        expect(serialized[0][1]).toMatch(/^0x[0-9a-f]+$/); // Valor deve ser Hex
    });
});