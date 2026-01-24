
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file state.ts
 * @description Definição do Estado Global e Estruturas de Dados (Single Source of Truth).
 */

import { getTodayUTCIso } from './utils';

// --- TYPES & INTERFACES ---

export type StoicVirtue = 'Wisdom' | 'Courage' | 'Justice' | 'Temperance';
export type StoicLevel = 1 | 2 | 3;
export type StoicDiscipline = 'Desire' | 'Action' | 'Assent';
export type GovernanceSphere = 'Biological' | 'Structural' | 'Social' | 'Mental';
export type HabitNature = 'Addition' | 'Subtraction';

export interface HabitPhilosophy {
  readonly sphere: GovernanceSphere;
  readonly level: StoicLevel;
  readonly virtue: StoicVirtue;
  readonly discipline: StoicDiscipline;
  readonly nature: HabitNature;
  readonly conscienceKey: string;
  readonly stoicConcept: string;
  readonly masterQuoteId: string;
}

export type Frequency =
    | { readonly type: 'daily' }
    | { readonly type: 'interval'; readonly unit: 'days' | 'weeks'; readonly amount: number }
    | { readonly type: 'specific_days_of_week'; readonly days: readonly number[] };

export interface HabitDayData {
    goalOverride?: number;
    note?: string;
}

export type HabitDailyInstances = Partial<Record<TimeOfDay, HabitDayData>>;

export interface HabitDailyInfo {
    instances: HabitDailyInstances;
    dailySchedule: TimeOfDay[] | undefined;
}

export interface HabitGoal { 
    readonly type: 'pages' | 'minutes' | 'check'; 
    readonly total?: number; 
    readonly unitKey?: string;
}

export interface HabitSchedule {
    readonly startDate: string;
    endDate?: string; 
    readonly icon: string;
    readonly color: string;
    readonly goal: HabitGoal;
    readonly philosophy?: HabitPhilosophy;
    readonly name?: string;
    readonly subtitle?: string;
    readonly nameKey?: string;
    readonly subtitleKey?: string;
    readonly times: readonly TimeOfDay[];
    readonly frequency: Frequency;
    readonly scheduleAnchor: string;
}

export interface Habit {
    readonly id: string;
    createdOn: string; 
    graduatedOn?: string; 
    scheduleHistory: HabitSchedule[];
}

export interface DailyStoicDiagnosis {
    readonly level: StoicLevel;
    readonly themes: readonly string[];
    readonly timestamp: number;
}

export interface QuoteDisplayState {
    readonly currentId: string;
    readonly displayedAt: number;
    readonly lockedContext: string;
}

export interface SyncLog {
    time: number;
    msg: string;
    type: 'success' | 'error' | 'info';
    icon?: string; 
}

export interface AppState {
    readonly version: number;
    lastModified: number; 
    readonly habits: readonly Habit[];
    readonly dailyData: Record<string, Record<string, HabitDailyInfo>>;
    readonly archives: Record<string, string | Uint8Array>; 
    readonly dailyDiagnoses: Record<string, DailyStoicDiagnosis>;
    readonly notificationsShown: string[];
    readonly pending21DayHabitIds: string[];
    readonly pendingConsolidationHabitIds: string[];
    readonly quoteState?: QuoteDisplayState;
    readonly hasOnboarded: boolean; 
    readonly syncLogs: SyncLog[];
    monthlyLogs: Map<string, bigint>; // Bitmask Storage (Solução 3)
}

/**
 * @fix Added HabitTemplate and PredefinedHabit interfaces
 */
export interface HabitTemplate {
    icon: string;
    color: string;
    times: TimeOfDay[];
    goal: HabitGoal;
    frequency: Frequency;
    name?: string;
    nameKey?: string;
    subtitleKey?: string;
    philosophy?: HabitPhilosophy;
}

export interface PredefinedHabit extends HabitTemplate {
    nameKey: string;
    subtitleKey: string;
    isDefault?: boolean;
}

// --- CONSTANTS ---
export const APP_VERSION = 8; 
export const STREAK_SEMI_CONSOLIDATED = 21;
export const STREAK_CONSOLIDATED = 66;

/**
 * @fix Added HABIT_STATE and PERIOD_OFFSET constants
 */
export const HABIT_STATE = {
    NULL: 0,
    DONE: 1,
    DEFERRED: 2,
    DONE_PLUS: 3
} as const;

export const PERIOD_OFFSET: Record<TimeOfDay, number> = {
    'Morning': 0,
    'Afternoon': 2,
    'Evening': 4
};

/**
 * @fix Added FREQUENCIES and STREAK_LOOKBACK_DAYS constants
 */
export const FREQUENCIES: { labelKey: string, value: Frequency }[] = [
    { labelKey: 'freqDaily', value: { type: 'daily' } },
    { labelKey: 'freqSpecificDaysOfWeek', value: { type: 'specific_days_of_week', days: [] } },
    { labelKey: 'freqEvery', value: { type: 'interval', unit: 'days', amount: 2 } }
];

export const STREAK_LOOKBACK_DAYS = 730;

export const TIMES_OF_DAY = ['Morning', 'Afternoon', 'Evening'] as const;
export type TimeOfDay = typeof TIMES_OF_DAY[number];

export const LANGUAGES = [
    { code: 'pt', nameKey: 'langPortuguese' },
    { code: 'en', nameKey: 'langEnglish' },
    { code: 'es', nameKey: 'langSpanish' }
] as const;
export type Language = typeof LANGUAGES[number];

// --- APPLICATION STATE ---
export const state: {
    habits: Habit[];
    lastModified: number;
    dailyData: Record<string, Record<string, HabitDailyInfo>>;
    archives: Record<string, string | Uint8Array>;
    dailyDiagnoses: Record<string, DailyStoicDiagnosis>;
    unarchivedCache: Map<string, Record<string, Record<string, HabitDailyInfo>>>;
    streaksCache: Map<string, Map<string, number>>;
    habitAppearanceCache: Map<string, Map<string, boolean>>;
    scheduleCache: Map<string, Map<string, HabitSchedule | null>>;
    activeHabitsCache: Map<string, Array<{ habit: Habit; schedule: TimeOfDay[] }>>;
    /**
     * @fix Added daySummaryCache
     */
    daySummaryCache: Map<string, any>;
    selectedDate: string;
    activeLanguageCode: Language['code'];
    pending21DayHabitIds: string[];
    pendingConsolidationHabitIds: string[];
    notificationsShown: string[];
    hasOnboarded: boolean; 
    syncLogs: SyncLog[];
    quoteState?: QuoteDisplayState;
    aiState: 'idle' | 'loading' | 'completed' | 'error';
    aiReqId: number;
    hasSeenAIResult: boolean;
    lastAIResult: string | null;
    /**
     * @fix Added lastAIError
     */
    lastAIError?: string;
    syncState: 'syncInitial' | 'syncSaving' | 'syncSynced' | 'syncError';
    fullCalendar: { year: number; month: number; };
    uiDirtyState: { calendarVisuals: boolean; habitListStructure: boolean; chartData: boolean; };
    monthlyLogs: Map<string, bigint>;
    /**
     * @fix Added editingHabit, confirmAction, confirmEditAction, editingNoteFor, and calendarDates
     */
    editingHabit?: { isNew: boolean; habitId?: string; originalData?: any; formData: HabitTemplate; targetDate: string };
    confirmAction: (() => void) | null;
    confirmEditAction: (() => void) | null;
    editingNoteFor: { habitId: string; date: string; time: TimeOfDay } | null;
    calendarDates: string[];
} = {
    habits: [],
    lastModified: 0,
    dailyData: {},
    archives: {},
    dailyDiagnoses: {},
    unarchivedCache: new Map(),
    streaksCache: new Map(),
    habitAppearanceCache: new Map(),
    scheduleCache: new Map(),
    activeHabitsCache: new Map(),
    daySummaryCache: new Map(),
    selectedDate: getTodayUTCIso(),
    activeLanguageCode: 'pt',
    pending21DayHabitIds: [],
    pendingConsolidationHabitIds: [],
    notificationsShown: [],
    hasOnboarded: false,
    syncLogs: [],
    aiState: 'idle',
    aiReqId: 0,
    hasSeenAIResult: true,
    lastAIResult: null,
    syncState: 'syncInitial',
    fullCalendar: { year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() },
    uiDirtyState: { calendarVisuals: true, habitListStructure: true, chartData: true },
    monthlyLogs: new Map(),
    confirmAction: null,
    confirmEditAction: null,
    editingNoteFor: null,
    calendarDates: []
};

/**
 * Extrai o estado atual para um formato serializável (JSON-safe para sync).
 */
export function getPersistableState(): AppState {
    return {
        version: APP_VERSION,
        lastModified: state.lastModified,
        habits: state.habits,
        dailyData: state.dailyData,
        archives: state.archives,
        dailyDiagnoses: state.dailyDiagnoses,
        notificationsShown: state.notificationsShown,
        pending21DayHabitIds: state.pending21DayHabitIds,
        pendingConsolidationHabitIds: state.pendingConsolidationHabitIds,
        quoteState: state.quoteState,
        hasOnboarded: state.hasOnboarded,
        syncLogs: state.syncLogs,
        monthlyLogs: state.monthlyLogs
    };
}

export function clearActiveHabitsCache() {
    state.activeHabitsCache.clear();
}

/**
 * @fix Added exported members getHabitDailyInfoForDate, ensureHabitDailyInfo, ensureHabitInstanceData, clearScheduleCache, invalidateCachesForDateChange, isDateLoading, isChartDataDirty, invalidateChartCache
 */
export function getHabitDailyInfoForDate(dateISO: string): Record<string, HabitDailyInfo> {
    if (!state.dailyData[dateISO]) {
        state.dailyData[dateISO] = {};
    }
    return state.dailyData[dateISO];
}

export function ensureHabitDailyInfo(dateISO: string, habitId: string): HabitDailyInfo {
    const dayData = getHabitDailyInfoForDate(dateISO);
    if (!dayData[habitId]) {
        dayData[habitId] = { instances: {}, dailySchedule: undefined };
    }
    return dayData[habitId];
}

export function ensureHabitInstanceData(dateISO: string, habitId: string, time: TimeOfDay): HabitDayData {
    const habitInfo = ensureHabitDailyInfo(dateISO, habitId);
    if (!habitInfo.instances[time]) {
        habitInfo.instances[time] = {};
    }
    return habitInfo.instances[time]!;
}

export function clearScheduleCache() {
    state.scheduleCache.clear();
}

export function invalidateCachesForDateChange(dateISO: string, habitIds: string[]) {
    state.daySummaryCache.delete(dateISO);
    state.streaksCache.forEach((cache) => cache.delete(dateISO));
    state.habitAppearanceCache.forEach((cache) => cache.delete(dateISO));
    state.scheduleCache.forEach((cache) => cache.delete(dateISO));
}

export function isDateLoading(dateISO: string): boolean {
    return false;
}

export function isChartDataDirty(): boolean {
    return state.uiDirtyState.chartData;
}

export function invalidateChartCache() {
    state.uiDirtyState.chartData = true;
}
