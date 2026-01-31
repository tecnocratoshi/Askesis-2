const REQUIRED_ENV = [
  'GEMINI_API_KEY',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN'
];

const OPTIONAL_ENV = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN'
];

function hasAny(envs) {
  return envs.some((k) => !!process.env[k]);
}

function missingRequired() {
  return REQUIRED_ENV.filter((k) => !process.env[k]);
}

const missing = missingRequired();
if (missing.length) {
  console.error(`\n[preflight] Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
  if (hasAny(OPTIONAL_ENV)) {
    console.error('[preflight] Detectado Upstash. Use KV_REST_* ou remova os REQUIRED_ENV.');
  }
  process.exit(1);
}

console.log('[preflight] OK: variáveis obrigatórias presentes.');
