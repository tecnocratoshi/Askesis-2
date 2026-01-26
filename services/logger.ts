/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file logger.ts
 * @description Sistema de logging estruturado com níveis, timestamps e contexto.
 * Pragma simples: sem dependências externas, apenas console.* nativo com formatação.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  module?: string;
  userId?: string;
  habitId?: string;
  syncId?: string;
  [key: string]: any;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  data?: any;
  stack?: string;
}

// Configuração de nível de log mínimo (pode ser ajustado em runtime)
let minLogLevel: LogLevel = 'info';
const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Histórico de logs em memória (últimos 100)
const logHistory: LogEntry[] = [];
const MAX_HISTORY = 100;

// Mapa de cores para terminal/console
const colors = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
  reset: '\x1b[0m',
};

function formatTimestamp(date: Date): string {
  return date.toISOString();
}

function formatContext(context?: LogContext): string {
  if (!context) return '';
  const parts: string[] = [];
  if (context.module) parts.push(`[${context.module}]`);
  if (context.userId) parts.push(`user:${context.userId}`);
  if (context.habitId) parts.push(`habit:${context.habitId}`);
  if (context.syncId) parts.push(`sync:${context.syncId}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

function shouldLog(level: LogLevel): boolean {
  return levelPriority[level] >= levelPriority[minLogLevel];
}

function addToHistory(entry: LogEntry): void {
  logHistory.push(entry);
  if (logHistory.length > MAX_HISTORY) {
    logHistory.shift();
  }
}

function createLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  data?: any,
  stack?: string
): LogEntry {
  return {
    timestamp: formatTimestamp(new Date()),
    level,
    message,
    context,
    data,
    stack,
  };
}

/**
 * Logger estruturado para debugging e monitoramento em produção.
 * Uso: logger.info("Sincronia iniciada", { syncId: "sync-123" });
 */
export const logger = {
  /**
   * Log de nível DEBUG - Informações detalhadas para desenvolvimento
   */
  debug(message: string, context?: LogContext, data?: any): void {
    if (!shouldLog('debug')) return;

    const entry = createLogEntry('debug', message, context, data);
    addToHistory(entry);

    console.debug(
      `${colors.debug}[DEBUG]${colors.reset} ${entry.timestamp}${formatContext(context)} ${message}`,
      data || ''
    );
  },

  /**
   * Log de nível INFO - Informações importantes do fluxo
   */
  info(message: string, context?: LogContext, data?: any): void {
    if (!shouldLog('info')) return;

    const entry = createLogEntry('info', message, context, data);
    addToHistory(entry);

    console.log(
      `${colors.info}[INFO]${colors.reset} ${entry.timestamp}${formatContext(context)} ${message}`,
      data || ''
    );
  },

  /**
   * Log de nível WARN - Situações inesperadas mas recuperáveis
   */
  warn(message: string, context?: LogContext, data?: any): void {
    if (!shouldLog('warn')) return;

    const entry = createLogEntry('warn', message, context, data);
    addToHistory(entry);

    console.warn(
      `${colors.warn}[WARN]${colors.reset} ${entry.timestamp}${formatContext(context)} ${message}`,
      data || ''
    );
  },

  /**
   * Log de nível ERROR - Erros críticos que precisam atenção
   */
  error(message: string, context?: LogContext, error?: Error | any, data?: any): void {
    if (!shouldLog('error')) return;

    const stack = error instanceof Error ? error.stack : undefined;
    const entry = createLogEntry('error', message, context, data, stack);
    addToHistory(entry);

    console.error(
      `${colors.error}[ERROR]${colors.reset} ${entry.timestamp}${formatContext(context)} ${message}`,
      error || data || ''
    );
  },

  /**
   * Define o nível mínimo de log (reduz verbosidade em produção)
   */
  setLevel(level: LogLevel): void {
    minLogLevel = level;
    this.info(`Log level changed to ${level}`, { module: 'logger' });
  },

  /**
   * Obtém o histórico de logs para análise/relatório
   */
  getHistory(): LogEntry[] {
    return [...logHistory];
  },

  /**
   * Limpa o histórico de logs
   */
  clearHistory(): void {
    logHistory.length = 0;
  },

  /**
   * Exporta logs em JSON para envio ao servidor (útil para telemetria)
   */
  exportAsJSON(): string {
    return JSON.stringify(logHistory, null, 2);
  },

  /**
   * Obtém logs filtrados por nível
   */
  getByLevel(level: LogLevel): LogEntry[] {
    return logHistory.filter(entry => entry.level === level);
  },

  /**
   * Obtém logs dos últimos N minutos
   */
  getRecent(minutes: number): LogEntry[] {
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000);
    return logHistory.filter(entry => new Date(entry.timestamp) > cutoffTime);
  },
};

// Exportar para acesso global em dev
declare global {
  interface Window {
    __logger?: typeof logger;
  }
}

if (typeof window !== 'undefined') {
  (window as any).__logger = logger;
}

export default logger;
