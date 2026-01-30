/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

declare global {
    interface Element {
        attributeStyleMap?: {
            set(property: string, value: any): void;
            get(property: string): any;
            clear(): void;
        };
    }
    interface Window {
        OneSignal?: any[];
        OneSignalDeferred?: any[];
        scheduler?: {
            postTask<T>(callback: () => T | Promise<T>, options?: { priority?: 'user-blocking' | 'user-visible' | 'background'; signal?: AbortSignal; delay?: number }): Promise<T>;
        };
    }
}

export {};
