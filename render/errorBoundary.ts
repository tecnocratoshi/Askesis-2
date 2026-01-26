/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file errorBoundary.ts
 * @description Error Boundary simples para React que captura erros não-tratados em componentes.
 * Fallback gracioso com sugestão de reload ou modo offline.
 */

import { logger } from '../services/logger';

export interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  errorStack?: string;
  errorCount: number;
}

/**
 * Error Boundary simples implementado com class component pattern
 * (Necessário usar class para capturar erros de lifecycle)
 * Mas exportamos funções para uso em functional components
 */
export class ErrorBoundaryHandler {
  private static instance: ErrorBoundaryHandler;
  private state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
    errorStack: undefined,
    errorCount: 0,
  };

  private errorCallback: ((state: ErrorBoundaryState) => void) | null = null;

  private constructor() {
    // Setup de global error handlers
    window.addEventListener('error', this.handleGlobalError.bind(this));
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection.bind(this));
  }

  static getInstance(): ErrorBoundaryHandler {
    if (!ErrorBoundaryHandler.instance) {
      ErrorBoundaryHandler.instance = new ErrorBoundaryHandler();
    }
    return ErrorBoundaryHandler.instance;
  }

  /**
   * Registra callback para quando um erro ocorre
   */
  onError(callback: (state: ErrorBoundaryState) => void): void {
    this.errorCallback = callback;
  }

  /**
   * Captura erros síncronos (da renderização, event listeners, etc)
   */
  captureError(error: Error, errorInfo?: any): void {
    const state: ErrorBoundaryState = {
      hasError: true,
      errorMessage: error.message || 'Unknown error',
      errorStack: error.stack,
      errorCount: this.state.errorCount + 1,
    };

    this.state = state;

    logger.error(
      `React Component Error (${state.errorCount})`,
      { module: 'ErrorBoundary' },
      error,
      errorInfo
    );

    if (this.errorCallback) {
      this.errorCallback(state);
    }
  }

  /**
   * Captura erros globais não-tratados
   */
  private handleGlobalError(event: ErrorEvent): void {
    const error = event.error || new Error(event.message);
    const state: ErrorBoundaryState = {
      hasError: true,
      errorMessage: error.message || 'Uncaught error',
      errorStack: error.stack,
      errorCount: this.state.errorCount + 1,
    };

    this.state = state;

    logger.error(
      `Global Error (${state.errorCount})`,
      { module: 'ErrorBoundary-Global' },
      error
    );

    if (this.errorCallback) {
      this.errorCallback(state);
    }
  }

  /**
   * Captura promessas rejeitadas não-tratadas
   */
  private handleUnhandledRejection(event: PromiseRejectionEvent): void {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    const state: ErrorBoundaryState = {
      hasError: true,
      errorMessage: error.message || 'Unhandled promise rejection',
      errorStack: error.stack,
      errorCount: this.state.errorCount + 1,
    };

    this.state = state;

    logger.error(
      `Unhandled Promise Rejection (${state.errorCount})`,
      { module: 'ErrorBoundary-Promise' },
      error
    );

    if (this.errorCallback) {
      this.errorCallback(state);
    }

    // Prevenir comportamento padrão do browser
    event.preventDefault();
  }

  /**
   * Reseta o estado de erro
   */
  resetError(): void {
    this.state = {
      hasError: false,
      errorMessage: '',
      errorStack: undefined,
      errorCount: this.state.errorCount, // mantém contagem histórica
    };
  }

  /**
   * Obtém estado atual
   */
  getState(): ErrorBoundaryState {
    return { ...this.state };
  }

  /**
   * Força reload da página
   */
  reloadPage(): void {
    logger.info('Reloading page after error recovery', { module: 'ErrorBoundary' });
    window.location.reload();
  }
}

/**
 * Renderiza UI de fallback quando ocorre erro
 * Pode ser customizado conforme design da app
 */
export function renderErrorFallback(state: ErrorBoundaryState): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'error-boundary-fallback';
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 20px;
    text-align: center;
  `;

  const content = document.createElement('div');
  content.style.cssText = `
    max-width: 500px;
    background: rgba(0,0,0,0.3);
    padding: 40px;
    border-radius: 12px;
    backdrop-filter: blur(10px);
  `;

  const title = document.createElement('h1');
  title.textContent = '😅 Algo deu errado';
  title.style.cssText = `
    margin: 0 0 10px 0;
    font-size: 28px;
    font-weight: 600;
  `;

  const message = document.createElement('p');
  message.textContent = 'A aplicação encontrou um erro inesperado. Tente recarregar a página.';
  message.style.cssText = `
    margin: 0 0 20px 0;
    font-size: 16px;
    opacity: 0.9;
  `;

  const error = document.createElement('p');
  error.textContent = `Erro: ${state.errorMessage}`;
  error.style.cssText = `
    margin: 0 0 20px 0;
    font-size: 13px;
    opacity: 0.7;
    font-family: monospace;
    word-break: break-all;
  `;

  const errorCount = document.createElement('p');
  errorCount.textContent = `Ocorrências: ${state.errorCount}`;
  errorCount.style.cssText = `
    margin: 0 0 30px 0;
    font-size: 12px;
    opacity: 0.6;
  `;

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  `;

  const reloadBtn = document.createElement('button');
  reloadBtn.textContent = '🔄 Recarregar';
  reloadBtn.style.cssText = `
    flex: 1;
    min-width: 150px;
    padding: 12px 24px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.3s;
  `;
  reloadBtn.onmouseover = () => { reloadBtn.style.background = '#45a049'; };
  reloadBtn.onmouseout = () => { reloadBtn.style.background = '#4CAF50'; };
  reloadBtn.onclick = () => {
    ErrorBoundaryHandler.getInstance().reloadPage();
  };

  const offlineBtn = document.createElement('button');
  offlineBtn.textContent = '📴 Modo Offline';
  offlineBtn.style.cssText = `
    flex: 1;
    min-width: 150px;
    padding: 12px 24px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.3s;
  `;
  offlineBtn.onmouseover = () => { offlineBtn.style.background = '#0b7dda'; };
  offlineBtn.onmouseout = () => { offlineBtn.style.background = '#2196F3'; };
  offlineBtn.onclick = () => {
    ErrorBoundaryHandler.getInstance().resetError();
    // Dispara evento para app voltar ao modo offline
    window.dispatchEvent(new CustomEvent('askesis:error-recovery', {
      detail: { mode: 'offline' }
    }));
  };

  content.appendChild(title);
  content.appendChild(message);
  content.appendChild(error);
  content.appendChild(errorCount);
  content.appendChild(buttonContainer);
  buttonContainer.appendChild(reloadBtn);
  buttonContainer.appendChild(offlineBtn);
  container.appendChild(content);

  return container;
}

/**
 * Integra Error Boundary com renderização da app
 * Chamado no index.tsx
 */
export function setupErrorBoundary(rootElement: HTMLElement): void {
  const handler = ErrorBoundaryHandler.getInstance();

  handler.onError((state) => {
    // Log detalhado para telemetria
    logger.error(
      'Error boundary triggered',
      { module: 'ErrorBoundary-Setup' },
      { errorCount: state.errorCount, message: state.errorMessage }
    );

    // Se já houve muitos erros, mostrar fallback permanente
    if (state.errorCount >= 3) {
      rootElement.innerHTML = '';
      const fallback = renderErrorFallback(state);
      rootElement.appendChild(fallback);
    }
  });

  // Dispatch error recovery events to app
  window.addEventListener('askesis:error-recovery', (event: any) => {
    logger.info('Error recovery triggered', { 
      module: 'ErrorBoundary',
      mode: event.detail?.mode 
    });
    handler.resetError();
  });
}

export default ErrorBoundaryHandler.getInstance();
