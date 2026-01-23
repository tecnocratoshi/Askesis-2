/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { ui } from "../render/ui";
import { t } from "../i18n";
import { downloadRemoteState, syncStateWithCloud, setSyncStatus } from "../services/cloud";
import { loadState, saveState } from "../services/persistence";
import { renderApp, openSyncDebugModal, clearHabitDomCache } from "../render";
import { showConfirmationModal } from "../render/modals";
import { storeKey, clearKey, hasLocalSyncKey, getSyncKey, isValidKeyFormat } from "../services/api";
import { generateUUID } from "../utils";
import { getPersistableState, state, clearActiveHabitsCache } from "../state";
import { mergeStates } from "../services/dataMerge";

// --- UI HELPERS ---

function showView(view: 'inactive' | 'enterKey' | 'displayKey' | 'active') {
    ui.syncInactiveView.style.display = 'none';
    ui.syncEnterKeyView.style.display = 'none';
    ui.syncDisplayKeyView.style.display = 'none';
    ui.syncActiveView.style.display = 'none';

    if (ui.syncErrorMsg) ui.syncErrorMsg.classList.add('hidden');

    switch (view) {
        case 'inactive': ui.syncInactiveView.style.display = 'flex'; break;
        case 'enterKey': ui.syncEnterKeyView.style.display = 'flex'; break;
        case 'displayKey': 
            ui.syncDisplayKeyView.style.display = 'flex'; 
            const context = ui.syncDisplayKeyView.dataset.context;
            ui.keySavedBtn.textContent = (context === 'view') ? t('closeButton') : t('syncKeySaved');
            break;
        case 'active': ui.syncActiveView.style.display = 'flex'; break;
    }
}

function _toggleButtons(buttons: HTMLButtonElement[], disabled: boolean) {
    for (let i = 0; i < buttons.length; i++) {
        buttons[i].disabled = disabled;
    }
}

// --- LOGIC ---

async function _processKey(key: string) {
    const buttons = [ui.submitKeyBtn, ui.cancelEnterKeyBtn];
    _toggleButtons(buttons, true);
    
    if (ui.syncErrorMsg) ui.syncErrorMsg.classList.add('hidden');
    
    const originalBtnText = ui.submitKeyBtn.textContent;
    ui.submitKeyBtn.textContent = t('syncVerifying');

    const originalKey = getSyncKey();
    
    try {
        storeKey(key);
        
        const cloudState = await downloadRemoteState();

        if (cloudState) {
            const localState = getPersistableState();

            // REPAIR: Sanitização manual recomendada antes do merge
            if (cloudState.monthlyLogs && !(cloudState.monthlyLogs instanceof Map)) {
                cloudState.monthlyLogs = new Map(Object.entries(cloudState.monthlyLogs)); 
            }

            // SMART MERGE & HYDRATION
            const mergedState = await mergeStates(localState, cloudState);
            
            // CRITICAL FIX [2025-06-05]: Use loadState instead of Object.assign.
            // loadState handles cache clearing, Map hydration and DOM resetting properly.
            await loadState(mergedState);
            
            // FORCE CLEAN REBUILD
            clearActiveHabitsCache();
            clearHabitDomCache();
            state.uiDirtyState.habitListStructure = state.uiDirtyState.calendarVisuals = state.uiDirtyState.chartData = true;

            await saveState(true); // Suppress sync to avoid loop
            renderApp();
            
            setSyncStatus('syncSynced');
            syncStateWithCloud(mergedState, true);
        } else {
            setSyncStatus('syncSynced');
            syncStateWithCloud(getPersistableState(), true);
        }
        _refreshViewState(); 
    } catch (error: any) {
        if (originalKey) storeKey(originalKey);
        else clearKey();

        if (ui.syncErrorMsg) {
            let msg = error.message || "Erro desconhecido";
            if (msg.includes('401')) msg = "Chave Inválida";
            ui.syncErrorMsg.textContent = msg;
            ui.syncErrorMsg.classList.remove('hidden');
        }
        setSyncStatus('syncError');
        _refreshViewState();
    } finally {
        ui.submitKeyBtn.textContent = originalBtnText;
        _toggleButtons(buttons, false);
    }
}

// --- HANDLERS ---

const _handleEnableSync = () => {
    try {
        ui.enableSyncBtn.disabled = true;
        if (ui.syncErrorMsg) ui.syncErrorMsg.classList.add('hidden');
        
        const newKey = generateUUID();
        storeKey(newKey);
        setSyncStatus('syncSynced');
        
        ui.syncKeyText.textContent = newKey;
        ui.syncDisplayKeyView.dataset.context = 'setup';
        showView('displayKey');
        syncStateWithCloud(getPersistableState(), true);
        
        setTimeout(() => ui.enableSyncBtn.disabled = false, 500);
    } catch (e: any) {
        ui.enableSyncBtn.disabled = false;
        if (ui.syncErrorMsg) {
            ui.syncErrorMsg.textContent = e.message || "Erro ao gerar chave";
            ui.syncErrorMsg.classList.remove('hidden');
        }
    }
};

const _handleEnterKeyView = () => {
    showView('enterKey');
    setTimeout(() => ui.syncKeyInput.focus(), 100);
};

const _handleCancelEnterKey = () => {
    ui.syncKeyInput.value = '';
    if (ui.syncErrorMsg) ui.syncErrorMsg.classList.add('hidden');
    _refreshViewState();
};

const _handleSubmitKey = () => {
    const key = ui.syncKeyInput.value.trim();
    if (!key) return;

    if (ui.syncErrorMsg) ui.syncErrorMsg.classList.add('hidden');

    if (!isValidKeyFormat(key)) {
        showConfirmationModal(
            t('confirmInvalidKeyBody'),
            () => _processKey(key),
            {
                title: t('confirmInvalidKeyTitle'),
                confirmText: t('confirmButton'),
                cancelText: t('cancelButton')
            }
        );
    } else {
        _processKey(key);
    }
};

const _handleKeySaved = () => showView('active');

const _handleCopyKey = () => {
    const key = ui.syncKeyText.textContent;
    if(key) {
        navigator.clipboard.writeText(key)
            .then(() => {
                const originalText = ui.copyKeyBtn.innerHTML;
                ui.copyKeyBtn.innerHTML = '✓';
                setTimeout(() => { ui.copyKeyBtn.innerHTML = originalText; }, 1500);
            })
            .catch(() => alert("Copie manualmente: " + key));
    }
};

const _handleViewKey = () => {
    const key = getSyncKey();
    if (key) {
        ui.syncKeyText.textContent = key;
        ui.syncDisplayKeyView.dataset.context = 'view';
        showView('displayKey');
    }
};

const _handleDisableSync = () => {
    showConfirmationModal(
        t('confirmSyncDisable'),
        () => {
            clearKey();
            setSyncStatus('syncInitial');
            showView('inactive');
        },
        { 
            title: t('syncDisableTitle'), 
            confirmText: t('syncDisableConfirm'),
            confirmButtonStyle: 'danger'
        }
    );
};

const _handleDiagnostics = (e: Event) => {
    openSyncDebugModal();
};

function _refreshViewState() {
    const hasKey = hasLocalSyncKey();
    if (hasKey) {
        showView('active');
        if (state.syncState === 'syncInitial') {
             setSyncStatus('syncSynced');
        }
    } else {
        showView('inactive');
        setSyncStatus('syncInitial');
    }
}

export function initSync() {
    if (ui.enableSyncBtn) ui.enableSyncBtn.addEventListener('click', _handleEnableSync);
    if (ui.enterKeyViewBtn) ui.enterKeyViewBtn.addEventListener('click', _handleEnterKeyView);
    if (ui.cancelEnterKeyBtn) ui.cancelEnterKeyBtn.addEventListener('click', _handleCancelEnterKey);
    if (ui.submitKeyBtn) ui.submitKeyBtn.addEventListener('click', _handleSubmitKey);
    if (ui.keySavedBtn) ui.keySavedBtn.addEventListener('click', _handleKeySaved);
    if (ui.copyKeyBtn) ui.copyKeyBtn.addEventListener('click', _handleCopyKey);
    if (ui.viewKeyBtn) ui.viewKeyBtn.addEventListener('click', _handleViewKey);
    if (ui.disableSyncBtn) ui.disableSyncBtn.addEventListener('click', _handleDisableSync);
    
    if (ui.syncStatus) ui.syncStatus.addEventListener('pointerdown', _handleDiagnostics);

    _refreshViewState();
}