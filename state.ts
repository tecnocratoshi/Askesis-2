
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file state.ts
 * @description Definição do Estado Global e Estruturas de Dados (Single Source of Truth).
 */

import { addDays, getTodayUTC, getTodayUTCIso, decompressString, decompressFromBuffer } from './utils';

// --- ERROR TYPES ---
export class DataLoadingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DataLoadingError";
    }
}

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

// --- FIX: Added HabitTemplate and PredefinedHabit exported interfaces ---
export interface HabitTemplate {
    readonly icon: string;
    readonly color: string;
    readonly times: readonly TimeOfDay[];
    readonly goal: HabitGoal;
    readonly frequency: Frequency;
    readonly name?: string;
    readonly nameKey?: string;
    readonly subtitle?: string;
    readonly subtitleKey?: string;
    readonly philosophy?: HabitPhilosophy;
}

export interface PredefinedHabit extends HabitTemplate {
    readonly isDefault?: boolean;
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

export interface DaySummary {
    readonly total: number;
    readonly completed: number;
    readonly snoozed: number;
    readonly pending: number;
    readonly completedPercent: number;
    readonly snoozedPercent: number;
    readonly showPlusIndicator: boolean;
}

// --- BITMASK STRUCTURES ---
export const PERIOD_OFFSET = { Morning: 0, Afternoon: 2, Evening: 4 } as const;
export const HABIT_STATE = { NULL: 0, DONE: 1, DEFERRED: 2, DONE_PLUS: 3 } as const;

export interface AppState {
    readonly version: number;
    lastModified: number; 
    readonly habits: readonly Habit[];
    readonly dailyData: Readonly<Record<string, Readonly<Record<string, HabitDailyInfo>>>>;
    readonly archives: Readonly<Record<string, string | Uint8Array>>; 
    readonly dailyDiagnoses: Readonly<Record<string, DailyStoicDiagnosis>>;
    readonly notificationsShown: readonly string[];
    readonly pending21DayHabitIds: readonly string[];
    readonly pendingConsolidationHabitIds: readonly string[];
    readonly quoteState?: QuoteDisplayState;
    readonly hasOnboarded: boolean; 
    readonly syncLogs: SyncLog[];
    monthlyLogs?: Map<string, bigint>;
}

// --- CONSTANTS ---
export const APP_VERSION = 7; 
export const STREAK_SEMI_CONSOLIDATED = 21;
export const STREAK_CONSOLIDATED = 66;
export const STREAK_LOOKBACK_DAYS = 730;

export const TIMES_OF_DAY = ['Morning', 'Afternoon', 'Evening'] as const;
export type TimeOfDay = typeof TIMES_OF_DAY[number];

export const LANGUAGES = [
    { code: 'pt', nameKey: 'langPortuguese' },
    { code: 'en', nameKey: 'langEnglish' },
    { code: 'es', nameKey: 'langSpanish' }
] as const;
export type Language = typeof LANGUAGES[number];

export const FREQUENCIES = [
    { labelKey: 'freqDaily', value: { type: 'daily' } },
    { labelKey: 'freqEvery', value: { type: 'interval', unit: 'days', amount: 2 } },
    { labelKey: 'freqSpecificDaysOfWeek', value: { type: 'specific_days_of_week', days: [] } }
] as const;

const _createMonomorphicDailyInfo = (): HabitDailyInfo => ({ instances: {}, dailySchedule: undefined });
const _createMonomorphicInstance = (): HabitDayData => ({ goalOverride: undefined, note: undefined });

// --- APPLICATION STATE ---
// @fix: Added monthlyLogs and other missing properties to the state singleton.
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
    daySummaryCache: Map<string, DaySummary>;
    calendarDates: Date[];
    selectedDate: string;
    activeLanguageCode: Language['code'];
    pending21DayHabitIds: string[];
    pendingConsolidationHabitIds: string[];
    notificationsShown: string[];
    hasOnboarded: boolean; 
    syncLogs: SyncLog[];
    confirmAction: (() => void) | null;
    confirmEditAction: (() => void) | null;
    editingNoteFor: { habitId: string; date: string; time: TimeOfDay; } | null;
    editingHabit: any | null;
    quoteState?: QuoteDisplayState;
    aiState: 'idle' | 'loading' | 'completed' | 'error';
    aiReqId: number;
    hasSeenAIResult: boolean;
    lastAIResult: string | null;
    lastAIError: string | null;
    syncState: 'syncInitial' | 'syncSaving' | 'syncSynced' | 'syncError';
    syncLastError: string | null;
    fullCalendar: { year: number; month: number; };
    uiDirtyState: { calendarVisuals: boolean; habitListStructure: boolean; chartData: boolean; };
    monthlyLogs: Map<string, bigint>;
} = {
    habits: [],
    lastModified: Date.now(),
    dailyData: {},
    archives: {},
    dailyDiagnoses: {},
    unarchivedCache: new Map(),
    streaksCache: new Map(),
    habitAppearanceCache: new Map(),
    scheduleCache: new Map(),
    activeHabitsCache: new Map(),
    daySummaryCache: new Map(),
    calendarDates: [],
    selectedDate: getTodayUTCIso(),
    activeLanguageCode: 'pt',
    pending21DayHabitIds: [],
    pendingConsolidationHabitIds: [],
    notificationsShown: [],
    hasOnboarded: false,
    syncLogs: [],
    confirmAction: null,
    confirmEditAction: null,
    editingNoteFor: null,
    editingHabit: null,
    aiState: 'idle',
    aiReqId: 0,
    hasSeenAIResult: true,
    lastAIResult: null,
    lastAIError: null,
    syncState: 'syncInitial',
    syncLastError: null,
    fullCalendar: { year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() },
    uiDirtyState: { calendarVisuals: true, habitListStructure: true, chartData: true },
    monthlyLogs: new Map()
};

// --- STATE ACCESSORS & MUTATORS ---

/**
 * @fix: Added missing state accessors and mutators.
 */

export function getHabitDailyInfoForDate(dateISO: string): Record<string, HabitDailyInfo> {
    return state.dailyData[dateISO] || {};
}

export function ensureHabitDailyInfo(dateISO: string, habitId: string): HabitDailyInfo {
    if (!state.dailyData[dateISO]) {
        state.dailyData[dateISO] = {};
    }
    if (!state.dailyData[dateISO][habitId]) {
        state.dailyData[dateISO][habitId] = _createMonomorphicDailyInfo();
    }
    return state.dailyData[dateISO][habitId];
}

export function ensureHabitInstanceData(dateISO: string, habitId: string, time: TimeOfDay): HabitDayData {
    const dailyInfo = ensureHabitDailyInfo(dateISO, habitId);
    if (!dailyInfo.instances[time]) {
        dailyInfo.instances[time] = _createMonomorphicInstance();
    }
    return dailyInfo.instances[time]!;
}

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

// --- CACHE MANAGEMENT ---

export function clearScheduleCache() {
    state.scheduleCache.clear();
    state.habitAppearanceCache.clear();
}

export function clearActiveHabitsCache() {
    state.activeHabitsCache.clear();
}

export function invalidateCachesForDateChange(dateISO: string, habitIds: string[]) {
    state.daySummaryCache.delete(dateISO);
    state.activeHabitsCache.delete(dateISO);
    habitIds.forEach(id => {
        state.streaksCache.get(id)?.clear();
        state.habitAppearanceCache.get(id)?.clear();
    });
    state.uiDirtyState.chartData = true;
}

export function invalidateChartCache() {
    state.uiDirtyState.chartData = true;
}

export function isChartDataDirty(): boolean {
    return state.uiDirtyState.chartData;
}

export function isDateLoading(dateISO: string): boolean {
    return false;
}
