/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file render/dom.ts
 * @description Abstrações de Baixo Nível para Manipulação do DOM (DOM Utils).
 */

import { t } from '../i18n';

/**
 * OTIMIZAÇÃO DE PERFORMANCE: Helper para atualizar texto do DOM.
 */
export function setTextContent(element: Element | null, text: string) {
    if (!element) return;
    if (element.firstChild && element.firstChild.nodeType === 3 && !element.firstChild.nextSibling) {
        if (element.firstChild.nodeValue !== text) {
            element.firstChild.nodeValue = text;
        }
    } else {
        if (element.textContent !== text) {
            element.textContent = text;
        }
    }
}

/**
 * Exibe uma notificação temporária (Toast) na parte inferior da tela.
 * Otimizado para não bloquear a thread principal (Zero-Blocking).
 */
export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', icon?: string) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    
    // As mensagens vem de t(), garantindo segurança contra injeção.
    toast.innerHTML = `
        <span class="toast-icon">${icon || ''}</span>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);
    
    // Auto-remove com animação de saída
    setTimeout(() => {
        toast.classList.add('toast--exit');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 4000);
}

/**
 * Atualiza os atributos ARIA para o componente 'Reel Rotary'.
 */
export function updateReelRotaryARIA(viewportEl: HTMLElement, currentIndex: number, options: readonly string[] | string[], labelKey: string) {
    if (!viewportEl) return;
    viewportEl.setAttribute('role', 'slider');
    viewportEl.setAttribute('aria-label', t(labelKey));
    viewportEl.setAttribute('aria-valuemin', '1');
    viewportEl.setAttribute('aria-valuemax', String(options.length));
    viewportEl.setAttribute('aria-valuenow', String(currentIndex + 1));
    viewportEl.setAttribute('aria-valuetext', options[currentIndex] || '');
    viewportEl.setAttribute('tabindex', '0');
}