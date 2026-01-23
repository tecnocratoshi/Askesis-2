
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file render/modals.ts
 * @description Motor de Renderização de Modais e Diálogos (UI Overlay Layer).
 */

import { state, Habit, HabitTemplate, Frequency, PredefinedHabit, TimeOfDay, STREAK_CONSOLIDATED, TIMES_OF_DAY, FREQUENCIES, LANGUAGES, getHabitDailyInfoForDate } from '../state';
import { PREDEFINED_HABITS } from '../data/predefinedHabits';
import { getScheduleForDate, calculateHabitStreak, getHabitDisplayInfo } from '../services/selectors';
import { ui } from './ui';
import { t, compareStrings, formatDate, formatInteger, getTimeOfDayName } from '../i18n';
import { HABIT_ICONS, UI_ICONS, getTimeOfDayIcon } from './icons';
import { setTextContent, updateReelRotaryARIA } from './dom';
import { escapeHTML, getContrastColor, parseUTCIsoDate, getTodayUTCIso, getSafeDate, triggerHaptic } from '../utils';

interface ModalContext { element: HTMLElement; previousFocus: HTMLElement | null; onClose?: () => void; firstFocusable?: HTMLElement; lastFocusable?: HTMLElement; }
const modalStack: ModalContext[] = [];
const OPTS_NOTES = { day: 'numeric', month: 'long', timeZone: 'UTC' } as const;
const COLORS = ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#9b59b6', '#1abc9c', '#34495e', '#e67e22', '#e84393', '#7f8c8d', '#26A69A', '#FFA726', '#5C6BC0', '#EC407A', '#9CCC65'];

function _getLeastUsedColor(): string {
    const counts = new Map(COLORS.map(c => [c, 0]));
    state.habits.forEach(h => {
        const lastSchedule = h.scheduleHistory[h.scheduleHistory.length - 1];
        if (!h.graduatedOn && lastSchedule && counts.has(lastSchedule.color)) {
            counts.set(lastSchedule.color, counts.get(lastSchedule.color)! + 1);
        }
    });
    let min = Math.min(...counts.values());
    const candidates = COLORS.filter(c => counts.get(c) === min);
    return candidates[state.habits.length % candidates.length];
}

export function initModalEngine() {
    document.addEventListener('keydown', e => {
        const ctx = modalStack[modalStack.length - 1]; if (!ctx) return;
        if (e.key === 'Escape') {
            triggerHaptic('light');
            closeModal(ctx.element);
        }
        else if (e.key === 'Tab') {
            const { firstFocusable: f, lastFocusable: l } = ctx;
            if (f && l) {
                if (e.shiftKey && document.activeElement === f) { l.focus(); e.preventDefault(); }
                else if (!e.shiftKey && document.activeElement === l) { f.focus(); e.preventDefault(); }
            }
        }
    });
    document.addEventListener('click', e => {
        const ctx = modalStack[modalStack.length - 1]; if (!ctx) return;
        if (e.target === ctx.element) {
            triggerHaptic('light');
            closeModal(ctx.element);
        }
    });
    // Global listener for reactive log updates
    document.addEventListener('sync-logs-updated', () => {
        if (ui.syncDebugModal.classList.contains('visible')) renderSyncLogs();
    });
}

export function openModal(modal: HTMLElement, focusEl?: HTMLElement, onClose?: () => void) {
    const ctx: ModalContext = { element: modal, previousFocus: document.activeElement as HTMLElement, onClose };
    const header = modal.querySelector('.modal-header');
    if (header) {
        const spacer = header.querySelector('.modal-header-spacer');
        if (spacer && !spacer.previousElementSibling?.classList.contains('modal-back-btn')) {
            const backBtn = document.createElement('button');
            backBtn.className = 'modal-back-btn';
            backBtn.innerHTML = UI_ICONS.backArrow;
            backBtn.setAttribute('aria-label', t('aria_go_back'));
            backBtn.addEventListener('click', () => { triggerHaptic('light'); closeModal(modal); });
            spacer.replaceWith(backBtn);
        }
    }
    modal.classList.add('visible');
    const fobs = modal.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (fobs.length) { ctx.firstFocusable = fobs[0]; ctx.lastFocusable = fobs[fobs.length - 1]; setTimeout(() => (focusEl || fobs[0]).focus(), 100); }
    modalStack.push(ctx); ui.appContainer.setAttribute('inert', '');
}

export function closeModal(modal: HTMLElement, suppressCallbacks = false) {
    const idx = modalStack.findIndex(c => c.element === modal); if (idx === -1) return;
    const [ctx] = modalStack.splice(idx, 1); modal.classList.remove('visible');
    if (modalStack.length === 0) ui.appContainer.removeAttribute('inert');
    const header = modal.querySelector('.modal-header');
    const backBtn = header?.querySelector('.modal-back-btn');
    if (header && backBtn) { const spacer = document.createElement('div'); spacer.className = 'modal-header-spacer'; backBtn.replaceWith(spacer); }
    if (!suppressCallbacks) ctx.onClose?.(); 
    ctx.previousFocus?.focus();
}

export function renderSyncLogs() {
    if (state.syncLogs.length === 0) {
        ui.syncLogsList.innerHTML = `<li class="sync-log-entry info"><em>${t('aiPromptNoData')}</em></li>`;
        return;
    }
    const OPTS_TIME: any = { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 1 };
    ui.syncLogsList.innerHTML = state.syncLogs.map(log => `
        <li class="sync-log-entry ${log.type}">
            <span class="log-time">[${new Date(log.time).toLocaleTimeString(state.activeLanguageCode, OPTS_TIME)}]</span>
            <span class="log-msg">${escapeHTML(log.msg)}</span>
        </li>
    `).join('');
}

export function openSyncDebugModal() {
    renderSyncLogs();
    openModal(ui.syncDebugModal);
}

export function setupManageModal() {
    if (state.habits.length === 0) { ui.habitList.classList.add('hidden'); ui.noHabitsMessage.classList.remove('hidden'); return; }
    ui.habitList.classList.remove('hidden'); ui.noHabitsMessage.classList.add('hidden');
    const items = state.habits.map(h => {
        const { name, subtitle } = getHabitDisplayInfo(h);
        const st = h.graduatedOn ? 'graduated' : (h.scheduleHistory[h.scheduleHistory.length-1].endDate ? 'ended' : 'active');
        return { h, st, name, subtitle };
    }).sort((a, b) => {
        const order = { active: 0, graduated: 1, ended: 2 };
        return (order[a.st] - order[b.st]) || compareStrings(a.name, b.name);
    });
    const today = getTodayUTCIso();
    ui.habitList.innerHTML = items.map(({ h, st, name, subtitle }) => {
        const lastSchedule = h.scheduleHistory[h.scheduleHistory.length - 1];
        return `<li class="habit-list-item ${st}" data-habit-id="${h.id}"><span class="habit-main-info"><span class="habit-icon-slot" style="color:${lastSchedule.color}">${lastSchedule.icon}</span><div style="display:flex;flex-direction:column;flex-grow:1;"><span class="habit-name">${name}</span>${subtitle ? `<span class="habit-subtitle" style="font-size:11px;color:var(--text-tertiary)">${subtitle}</span>` : ''}</div>${st !== 'active' ? `<span class="habit-name-status">${t(st === 'graduated' ? 'modalStatusGraduated' : 'modalStatusEnded')}</span>` : ''}</span><div class="habit-list-actions">${st === 'active' ? `${calculateHabitStreak(h, today) >= STREAK_CONSOLIDATED ? `<button class="graduate-habit-btn" aria-label="${t('aria_graduate', { name })}">${UI_ICONS.graduateAction}</button>` : `<button class="end-habit-btn" aria-label="${t('aria_end', { name })}">${UI_ICONS.endAction}</button>`}` : `<button class="permanent-delete-habit-btn" aria-label="${t('aria_delete_permanent', { name })}">${UI_ICONS.deletePermanentAction}</button>`}</div></li>`;
    }).join('');
}

export function showConfirmationModal(text: string, onConfirm: () => void, opts?: any) {
    ui.confirmModalText.innerHTML = text;
    state.confirmAction = onConfirm;
    state.confirmEditAction = opts?.onEdit || null;
    setTextContent(ui.confirmModal.querySelector('h2'), opts?.title || t('modalConfirmTitle'));
    ui.confirmModalConfirmBtn.className = `btn ${opts?.confirmButtonStyle === 'danger' ? 'btn--danger' : 'btn--primary'}`;
    setTextContent(ui.confirmModalConfirmBtn, opts?.confirmText || t('confirmButton'));
    ui.confirmModalEditBtn.classList.toggle('hidden', !opts?.onEdit);
    if (opts?.editText) setTextContent(ui.confirmModalEditBtn, opts.editText);
    const onCancel = () => { state.confirmAction = null; state.confirmEditAction = null; opts?.onCancel?.(); };
    openModal(ui.confirmModal, undefined, onCancel);
}

export function openNotesModal(habitId: string, date: string, time: TimeOfDay) {
    const h = state.habits.find(x => x.id === habitId); if (!h) return;
    state.editingNoteFor = { habitId, date, time };
    setTextContent(ui.notesModalTitle, getHabitDisplayInfo(h, date).name);
    setTextContent(ui.notesModalSubtitle, `${formatDate(parseUTCIsoDate(date), OPTS_NOTES)} - ${getTimeOfDayName(time)}`);
    // FIX: Using safer access for daily info to avoid potential 'undefined' property access issues
    const dayData = getHabitDailyInfoForDate(date);
    const habitInfo = dayData[habitId];
    ui.notesTextarea.value = habitInfo?.instances?.[time]?.note || '';
    openModal(ui.notesModal, ui.notesTextarea, () => state.editingNoteFor = null);
}

export function renderIconPicker() {
    if (!state.editingHabit) return;
    const { color: bg } = state.editingHabit.formData, fg = getContrastColor(bg);
    ui.iconPickerGrid.style.setProperty('--current-habit-bg-color', bg);
    ui.iconPickerGrid.style.setProperty('--current-habit-fg-color', fg);
    // COMPLETE: Ensured joined string for innerHTML to fix Type 'string[]' is not assignable to type 'string'
    ui.iconPickerGrid.innerHTML = Object.values(HABIT_ICONS).map(svg => `<button type="button" class="icon-picker-item" data-icon-svg="${escapeHTML(svg)}">${svg}</button>`).join('');
}

export function renderColorPicker() {
    // COMPLETE: Added implementation and ensured joined string for innerHTML
    ui.colorPickerGrid.innerHTML = COLORS.map(c => `<button type="button" class="color-swatch ${state.editingHabit?.formData.color === c ? 'selected' : ''}" data-color="${c}" style="background-color:${c}" aria-label="${c}"></button>`).join('');
}

export function renderExploreHabits() {
    // COMPLETE: Added implementation and ensured joined string for innerHTML
    ui.exploreHabitList.innerHTML = PREDEFINED_HABITS.map((h, i) => {
        const name = t(h.nameKey);
        const subtitle = t(h.subtitleKey);
        return `<div class="explore-habit-item" data-index="${i}" role="button" tabindex="0">
            <div class="habit-icon" style="color: ${h.color}; background-color: ${h.color}30">${h.icon}</div>
            <div class="habit-details">
                <div class="name">${name}</div>
                <div class="subtitle">${subtitle}</div>
            </div>
        </div>`;
    }).join('');
}

export function openEditModal(habit: Habit | PredefinedHabit | null) {
    // COMPLETE: Added implementation for opening edit modal for new or existing habits
    if (habit && 'id' in habit) {
        const h = habit as Habit;
        const lastSchedule = h.scheduleHistory[h.scheduleHistory.length - 1];
        state.editingHabit = {
            isNew: false,
            habitId: h.id,
            originalData: structuredClone(h),
            formData: {
                icon: lastSchedule.icon,
                color: lastSchedule.color,
                times: [...lastSchedule.times],
                goal: { ...lastSchedule.goal },
                frequency: { ...lastSchedule.frequency },
                name: lastSchedule.name,
                nameKey: lastSchedule.nameKey,
                subtitleKey: lastSchedule.subtitleKey,
                philosophy: lastSchedule.philosophy
            },
            targetDate: getTodayUTCIso()
        };
    } else {
        const template = habit as PredefinedHabit | null;
        state.editingHabit = {
            isNew: true,
            formData: {
                icon: template?.icon || Object.values(HABIT_ICONS)[0],
                color: template?.color || _getLeastUsedColor(),
                times: template?.times ? [...template.times] : ['Morning'],
                goal: template?.goal ? { ...template.goal } : { type: 'check', total: 1, unitKey: 'unitCheck' },
                frequency: template?.frequency ? { ...template.frequency } : { type: 'daily' },
                nameKey: template?.nameKey,
                subtitleKey: template?.subtitleKey || 'customHabitSubtitle',
                name: template ? undefined : '',
                philosophy: template?.philosophy
            },
            targetDate: getTodayUTCIso()
        };
    }

    refreshEditModalUI();
    openModal(ui.editHabitModal);
}

export function refreshEditModalUI() {
    // COMPLETE: Added implementation for refreshing edit modal elements
    if (!state.editingHabit) return;
    const { formData, isNew } = state.editingHabit;
    
    setTextContent(ui.editHabitModalTitle, t(isNew ? 'modalExploreCreateCustom' : 'modalEditTitle'));
    
    const habitNameInput = ui.editHabitForm.elements.namedItem('habit-name') as HTMLInputElement;
    habitNameInput.value = formData.nameKey ? t(formData.nameKey) : (formData.name || '');
    
    if (ui.habitSubtitleDisplay) {
        setTextContent(ui.habitSubtitleDisplay, t(formData.subtitleKey || 'customHabitSubtitle'));
    }

    ui.habitIconPickerBtn.innerHTML = formData.icon;
    ui.habitIconPickerBtn.style.backgroundColor = formData.color;
    ui.habitIconPickerBtn.style.color = getContrastColor(formData.color);

    // Update Times
    ui.habitTimeContainer.querySelectorAll('.segmented-control-option').forEach(btn => {
        const time = (btn as HTMLElement).dataset.time as TimeOfDay;
        btn.classList.toggle('selected', formData.times.includes(time));
    });

    renderFrequencyOptions();
}

export function renderFrequencyOptions() {
    // COMPLETE: Added implementation for rendering frequency radio buttons and sub-pickers
    if (!state.editingHabit) return;
    const { frequency } = state.editingHabit.formData;
    
    let html = `<div class="frequency-type-selector">`;
    FREQUENCIES.forEach(f => {
        const isSelected = frequency.type === f.value.type;
        html += `<label class="radio-option">
            <input type="radio" name="frequency-type" value="${f.value.type}" ${isSelected ? 'checked' : ''}>
            <span>${t(f.labelKey)}</span>
        </label>`;
    });
    html += `</div>`;

    if (frequency.type === 'specific_days_of_week') {
        html += `<div class="weekday-picker">`;
        [0, 1, 2, 3, 4, 5, 6].forEach(day => {
            const isChecked = frequency.days.includes(day);
            const dayName = formatDate(new Date(Date.UTC(2021, 0, 3 + day)), { weekday: 'narrow' });
            html += `<label class="weekday-option">
                <input type="checkbox" data-day="${day}" ${isChecked ? 'checked' : ''}>
                <span>${dayName}</span>
            </label>`;
        });
        html += `</div>`;
    } else if (frequency.type === 'interval') {
        html += `<div class="interval-picker">
            <button type="button" class="stepper-btn" data-action="interval-decrement">-</button>
            <div class="interval-value">
                <span class="amount">${frequency.amount}</span>
                <button type="button" class="unit-toggle-btn" data-action="interval-unit-toggle">${t(frequency.unit === 'days' ? 'unitDays' : 'unitWeeks', { count: frequency.amount })}</button>
            </div>
            <button type="button" class="stepper-btn" data-action="interval-increment">+</button>
        </div>`;
    }

    ui.frequencyOptionsContainer.innerHTML = html;
}

export function renderLanguageFilter() {
    // COMPLETE: Added implementation for adjusting language carousel visual state
    const currentIndex = LANGUAGES.findIndex(l => l.code === state.activeLanguageCode);
    const langNames = LANGUAGES.map(lang => t(lang.nameKey));
    
    ui.languageReel.style.transform = `translateX(-${currentIndex * 100}%)`;
    updateReelRotaryARIA(ui.languageViewport, currentIndex, langNames, 'language_ariaLabel');
}
