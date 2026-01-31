/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

/**
 * @file services/telemetry.ts
 * @description Telemetria mínima de erros críticos (sem dados sensíveis).
 */

import { logger } from '../utils';

const TELEMETRY_ENDPOINT = '/api/log';
const MAX_EVENTS_PER_SESSION = 5;
const STACK_LINES = 3;
const MAX_MESSAGE_LEN = 300;
const MAX_STACK_LEN = 800;

let _eventsSent = 0;
let _initialized = false;
let _lastSignature: string | null = null;
let _lastSignatureTime = 0;

function clamp(input: unknown, maxLen: number): string {
    if (!input) return '';
    const str = String(input);
    return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function sanitizeStack(stack?: string): string {
    if (!stack) return '';
    const lines = stack.split('\n').slice(0, STACK_LINES).join('\n');
    return clamp(lines, MAX_STACK_LEN);
}

function buildSignature(payload: any): string {
    return `${payload?.name || ''}|${payload?.message || ''}|${payload?.type || ''}`;
}

function send(payload: any) {
    if (process.env.NODE_ENV !== 'production') return;
    if (_eventsSent >= MAX_EVENTS_PER_SESSION) return;

    const signature = buildSignature(payload);
    const now = Date.now();
    if (_lastSignature === signature && now - _lastSignatureTime < 5000) return;
    _lastSignature = signature;
    _lastSignatureTime = now;

    _eventsSent++;

    const body = JSON.stringify(payload);

    try {
        if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon(TELEMETRY_ENDPOINT, blob);
            return;
        }
    } catch (e) {
        logger.warn('[Telemetry] sendBeacon failed', e);
    }

    fetch(TELEMETRY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
    }).catch(() => {});
}

function extractErrorData(err: unknown) {
    if (err instanceof Error) {
        return {
            name: clamp(err.name, 80),
            message: clamp(err.message, MAX_MESSAGE_LEN),
            stack: sanitizeStack(err.stack)
        };
    }
    return {
        name: 'Error',
        message: clamp(err, MAX_MESSAGE_LEN),
        stack: ''
    };
}

export function reportCriticalError(type: 'error' | 'unhandledrejection' | 'fatal', err: unknown, context?: Record<string, string>) {
    const data = extractErrorData(err);
    send({
        type,
        name: data.name,
        message: data.message,
        stack: data.stack,
        path: location?.pathname || '',
        ts: Date.now(),
        context: context ? Object.fromEntries(Object.entries(context).map(([k, v]) => [k, clamp(v, 120)])) : undefined
    });
}

export function initErrorTelemetry() {
    if (_initialized) return;
    _initialized = true;

    window.addEventListener('error', (event) => {
        const err = event.error || event.message;
        reportCriticalError('error', err, event.filename ? { file: event.filename } : undefined);
    });

    window.addEventListener('unhandledrejection', (event) => {
        reportCriticalError('unhandledrejection', event.reason);
    });
}
