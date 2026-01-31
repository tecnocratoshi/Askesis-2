const REQUIRED_ENV = [
  'GEMINI_API_KEY'
];

const KV_REQUIRED_ENV = [
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

function missingRequired(envs) {
  return envs.filter((k) => !process.env[k]);
}

const missingBase = missingRequired(REQUIRED_ENV);
if (missingBase.length) {
  console.error(`\n[preflight] Variáveis obrigatórias ausentes: ${missingBase.join(', ')}`);
  process.exit(1);
}

const hasKv = hasAny(KV_REQUIRED_ENV);
const hasUpstash = hasAny(OPTIONAL_ENV);

if (!hasKv && !hasUpstash) {
  console.error(`\n[preflight] Variáveis obrigatórias ausentes: ${KV_REQUIRED_ENV.join(', ')}`);
  console.error('[preflight] Defina KV_REST_* ou UPSTASH_REDIS_REST_* para habilitar o storage.');
  process.exit(1);
}

console.log('[preflight] OK: variáveis obrigatórias presentes.');
