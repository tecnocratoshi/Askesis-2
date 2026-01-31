/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file listeners/swipe.ts
 * @description Motor de Gestos para Interações de Deslize Horizontal (Swipe-to-Reveal).
 * 
 * [MAIN THREAD CONTEXT]:
 * Processamento de Pointer Events em alta frequência (~120Hz).
 * 
 * ARQUITETURA (Static State Machine & Integer Physics):
 * - Memory Locality: Estado em objeto estático para evitar alocações em frames.
 * - Smi Optimization: Coordenadas forçadas para Int32 (| 0).
 */

import { triggerHaptic } from '../utils';
import { DOM_SELECTORS, CSS_CLASSES } from '../render/constants';
import { renderApp } from '../render';
import { state } from '../state';
import {
    SWIPE_INTENT_THRESHOLD,
    SWIPE_ACTION_THRESHOLD,
    SWIPE_HAPTIC_THRESHOLD,
    SWIPE_BLOCK_CLICK_MS
} from '../constants';

// CONSTANTS (Smi Values)
const DIR_NONE = 0, DIR_HORIZ = 1, DIR_VERT = 2;
const INTENT_THRESHOLD = SWIPE_INTENT_THRESHOLD;
const ACTION_THRESHOLD = SWIPE_ACTION_THRESHOLD;
const HAPTIC_THRESHOLD = SWIPE_HAPTIC_THRESHOLD;

// PHYSICS CONSTANTS: Resistência progressiva e haptic incremental
const MAX_OVERSWIPE = 100;      // Máximo overswipe permitido em pixels
const RESISTANCE_FACTOR = 0.4; // Fator de resistência após limite (0-1, menor = mais resistência)
const HAPTIC_ZONES = [0.5, 0.75, 0.9, 1.0]; // Zonas de haptic progressivo (% do limite)
const SAFETY_TIMEOUT_MS = 3000; // Timeout de segurança para limpar estado residual

const SwipeState = {
    isActive: 0, startX: 0, startY: 0, currentX: 0, direction: DIR_NONE,
    wasOpenLeft: 0, wasOpenRight: 0, actionWidth: 60, pointerId: -1,
    rafId: 0, hasHaptics: 0, card: null as HTMLElement | null,
    content: null as HTMLElement | null, hasTypedOM: false,
    hapticZoneIndex: 0,         // Zona atual de haptic (para incremental)
    lastVisualX: 0,             // Última posição visual aplicada
    safetyTimeoutId: 0          // Timeout de segurança
};

export const isCurrentlySwiping = () => SwipeState.isActive === 1;
export const isSwipePending = () => SwipeState.card !== null;
export const cancelSwipeInteraction = () => {
    if (SwipeState.card) _reset();
};

function updateCachedLayoutValues() {
    const root = getComputedStyle(document.documentElement);
    SwipeState.actionWidth = parseInt(root.getPropertyValue('--swipe-action-width')) || 60;
    SwipeState.hasTypedOM = typeof window !== 'undefined' && !!(window.CSS && (window as any).CSSTranslate && CSS.px);
}

function _finalizeSwipeState(deltaX: number) {
    const { card, wasOpenLeft, wasOpenRight } = SwipeState;
    if (!card) return;

    if (wasOpenLeft) {
        if (deltaX < -ACTION_THRESHOLD) card.classList.remove(CSS_CLASSES.IS_OPEN_LEFT);
    } else if (wasOpenRight) {
        if (deltaX > ACTION_THRESHOLD) card.classList.remove(CSS_CLASSES.IS_OPEN_RIGHT);
    } else {
        if (deltaX > ACTION_THRESHOLD) card.classList.add(CSS_CLASSES.IS_OPEN_LEFT);
        else if (deltaX < -ACTION_THRESHOLD) card.classList.add(CSS_CLASSES.IS_OPEN_RIGHT);
    }
}

function _blockSubsequentClick(deltaX: number) {
    if ((deltaX < 0 ? -deltaX : deltaX) <= ACTION_THRESHOLD) return;
    const block = (e: MouseEvent) => {
        const t = e.target as HTMLElement;
        if (!t.closest(DOM_SELECTORS.SWIPE_DELETE_BTN) && !t.closest(DOM_SELECTORS.SWIPE_NOTE_BTN)) {
            e.stopPropagation(); e.preventDefault();
        }
        window.removeEventListener('click', block, true);
    };
    window.addEventListener('click', block, true);
    setTimeout(() => window.removeEventListener('click', block, true), SWIPE_BLOCK_CLICK_MS);
}

/**
 * Aplica resistência progressiva ao movimento de swipe.
 * Quando o usuário arrasta além do actionWidth, a resistência aumenta
 * exponencialmente, criando uma sensação de "borracha" realista.
 */
function _applyResistance(rawDelta: number, actionWidth: number): number {
    const absDelta = Math.abs(rawDelta);
    const sign = rawDelta >= 0 ? 1 : -1;
    
    // Dentro do limite normal: movimento 1:1 com o dedo
    if (absDelta <= actionWidth) {
        return rawDelta;
    }
    
    // Além do limite: resistência progressiva (diminui conforme avança)
    const overAmount = absDelta - actionWidth;
    const maxOver = MAX_OVERSWIPE;
    
    // Função de easing: quanto mais longe, maior a resistência
    // Usa raiz quadrada para desacelerar gradualmente
    const resistedOver = maxOver * (1 - Math.exp(-overAmount / (maxOver * RESISTANCE_FACTOR)));
    
    return sign * (actionWidth + resistedOver);
}

/**
 * Haptic feedback progressivo baseado em zonas.
 * Dispara feedback cada vez que cruza uma zona, com intensidade crescente.
 */
function _triggerProgressiveHaptic(progress: number) {
    // progress: 0-1+ (pode passar de 1 quando em overswipe)
    const clampedProgress = Math.min(progress, 1);
    
    for (let i = SwipeState.hapticZoneIndex; i < HAPTIC_ZONES.length; i++) {
        if (clampedProgress >= HAPTIC_ZONES[i]) {
            // Intensidade crescente por zona
            const intensity: 'light' | 'medium' | 'heavy' = 
                i < 2 ? 'light' : i < 3 ? 'medium' : 'heavy';
            triggerHaptic(intensity);
            SwipeState.hapticZoneIndex = i + 1;
        }
    }
    
    // Reset das zonas se voltar para trás
    if (clampedProgress < HAPTIC_ZONES[0] && SwipeState.hapticZoneIndex > 0) {
        SwipeState.hapticZoneIndex = 0;
    }
}

const _updateVisuals = () => {
    if (!SwipeState.card || !SwipeState.content || SwipeState.direction !== DIR_HORIZ) {
        SwipeState.rafId = 0; return;
    }

    let rawDelta = (SwipeState.currentX - SwipeState.startX) | 0;
    if (SwipeState.wasOpenLeft) rawDelta += SwipeState.actionWidth;
    if (SwipeState.wasOpenRight) rawDelta -= SwipeState.actionWidth;

    // Aplica resistência progressiva para movimento realista
    const tx = _applyResistance(rawDelta, SwipeState.actionWidth) | 0;
    SwipeState.lastVisualX = tx;

    // BLEEDING-EDGE PERF (CSS Typed OM): No "hot path" do gesto de swipe,
    // atualizamos o `transform` diretamente no motor de composição do navegador
    // sem o custo de serializar/parsear strings, garantindo a máxima fluidez.
    if (SwipeState.hasTypedOM && SwipeState.content.attributeStyleMap) {
        SwipeState.content.attributeStyleMap.set('transform', new (window as any).CSSTranslate(CSS.px(tx), CSS.px(0)));
    } else {
        SwipeState.content.style.transform = `translateX(${tx}px)`;
    }

    // Haptic progressivo baseado no progresso em direção ao limite
    const absRaw = Math.abs(rawDelta);
    const progress = absRaw / SwipeState.actionWidth;
    _triggerProgressiveHaptic(progress);

    SwipeState.rafId = 0;
};

const _reset = () => {
    // Limpa timeout de segurança primeiro
    if (SwipeState.safetyTimeoutId) {
        clearTimeout(SwipeState.safetyTimeoutId);
        SwipeState.safetyTimeoutId = 0;
    }
    if (SwipeState.rafId) cancelAnimationFrame(SwipeState.rafId);
    const { card, content, pointerId } = SwipeState;
    if (card) {
        if (pointerId !== -1) try { card.releasePointerCapture(pointerId); } catch(e){}
        card.classList.remove(CSS_CLASSES.IS_SWIPING);
        if (content) {
            if (SwipeState.hasTypedOM && content.attributeStyleMap) content.attributeStyleMap.clear();
            else content.style.transform = '';
            content.draggable = true;
        }
    }
    document.body.classList.remove('is-interaction-active', 'is-swipe-pending');
    if (state.uiDirtyState.habitListStructure) requestAnimationFrame(() => renderApp());
    
    window.removeEventListener('pointermove', _handlePointerMove);
    window.removeEventListener('pointerup', _handlePointerUp);
    window.removeEventListener('pointercancel', _reset);
    SwipeState.card = SwipeState.content = null;
    SwipeState.isActive = 0; SwipeState.direction = DIR_NONE; SwipeState.pointerId = -1;
    SwipeState.hapticZoneIndex = 0; SwipeState.lastVisualX = 0; // Reset physics state
};

const _handlePointerMove = (e: PointerEvent) => {
    if (!SwipeState.card) return;

    // Always update current position
    SwipeState.currentX = e.clientX | 0;

    // Detect intent on first move
    if (SwipeState.direction === DIR_NONE) {
        const dx = Math.abs(SwipeState.currentX - SwipeState.startX);
        const dy = Math.abs((e.clientY | 0) - SwipeState.startY);
        
        if (dx > INTENT_THRESHOLD || dy > INTENT_THRESHOLD) {
            if (dx > dy) {
                // Horizontal swipe confirmed
                SwipeState.direction = DIR_HORIZ;
                SwipeState.isActive = 1;
                document.body.classList.add('is-interaction-active');
                SwipeState.card.classList.add(CSS_CLASSES.IS_SWIPING);
                if (SwipeState.content) SwipeState.content.draggable = false;
                try { SwipeState.card.setPointerCapture(e.pointerId); SwipeState.pointerId = e.pointerId; } catch(e) {}
            } else {
                // Vertical scroll, abort swipe
                SwipeState.direction = DIR_VERT;
                _reset();
                return;
            }
        }
    }

    // Process horizontal swipe
    if (SwipeState.direction === DIR_HORIZ) {
        e.preventDefault(); // GESTURE LOCK: Previne scroll vertical do navegador
        if (!SwipeState.rafId) {
            SwipeState.rafId = requestAnimationFrame(_updateVisuals);
        }
    }
};

const _handlePointerUp = () => {
    if (SwipeState.card && SwipeState.direction === DIR_HORIZ) {
        const dx = (SwipeState.currentX - SwipeState.startX) | 0;
        _finalizeSwipeState(dx); _blockSubsequentClick(dx);
    }
    _reset();
};

export function setupSwipeHandler(container: HTMLElement) {
    updateCachedLayoutValues();
    container.addEventListener('pointerdown', (e) => {
        // ROBUSTNESS: Se ainda há estado residual, limpa forçadamente
        if (SwipeState.card) {
            _reset();
        }
        
        if (e.button !== 0) return;
        const cw = (e.target as HTMLElement).closest<HTMLElement>(DOM_SELECTORS.HABIT_CONTENT_WRAPPER);
        const card = cw?.closest<HTMLElement>(DOM_SELECTORS.HABIT_CARD);
        if (!card || !cw) return;

        const open = container.querySelector(`.${CSS_CLASSES.IS_OPEN_LEFT}, .${CSS_CLASSES.IS_OPEN_RIGHT}`);
        if (open && open !== card) open.classList.remove(CSS_CLASSES.IS_OPEN_LEFT, CSS_CLASSES.IS_OPEN_RIGHT);

        SwipeState.card = card; SwipeState.content = cw;
        SwipeState.startX = SwipeState.currentX = e.clientX | 0;
        SwipeState.startY = e.clientY | 0;
        SwipeState.wasOpenLeft = card.classList.contains(CSS_CLASSES.IS_OPEN_LEFT) ? 1 : 0;
        SwipeState.wasOpenRight = card.classList.contains(CSS_CLASSES.IS_OPEN_RIGHT) ? 1 : 0;
        SwipeState.hasHaptics = 0;
        SwipeState.hapticZoneIndex = 0;
        
        // EARLY LOCK: Marca o body como "potencialmente em interação" para prevenir
        // que clicks rápidos durante a detecção de intenção causem re-renders destrutivos.
        document.body.classList.add('is-swipe-pending');
        
        // SAFETY TIMEOUT: Se por algum motivo o pointerup/cancel não for disparado,
        // limpa o estado após 3 segundos para evitar travamento
        SwipeState.safetyTimeoutId = window.setTimeout(() => {
            if (SwipeState.card) {
                _reset();
            }
        }, SAFETY_TIMEOUT_MS);

        window.addEventListener('pointermove', _handlePointerMove, { passive: false });
        window.addEventListener('pointerup', _handlePointerUp);
        window.addEventListener('pointercancel', _reset);
    });
}
