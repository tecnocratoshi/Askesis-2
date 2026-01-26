/**
 * 🧪 VITEST SETUP
 * Configura extensões de matchers e ambiente global
 */

import '@testing-library/jest-dom';
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup após cada teste
afterEach(() => {
  cleanup();
});

// Mock de jest-axe se não disponível
if (typeof global !== 'undefined') {
  // Global setup se necessário
}
