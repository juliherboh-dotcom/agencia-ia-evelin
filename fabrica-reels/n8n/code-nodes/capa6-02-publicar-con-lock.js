const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "2. Publicar (con lock)"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * Reclama un lock at?mico sobre la fila de `publications` antes de hacer
 * nada (idempotencia + evita publicar dos veces el mismo render si dos
 * ciclos del schedule se solapan), llama a publish-api, y guarda el
 * resultado. Reintentos con backoff exponencial simple para errores
 * transitorios (rate limit, red).
 *
 * Campos de 0. Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * PUBLISH_API_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};
const PUBLISH_API_URL = cfg.PUBLISH_API_URL;
const TELEGRAM_BOT_TOKEN = cfg.TELEGRAM_BOT_TOKEN;

const MAX_ATTEMPTS = 3;
const WORKER_ID = `n8n-capa6-${$execution.id}`;

const pub = $json;

const sendTelegram = async (chatId, text) => this.helpers.httpRequest({
  method: 'POST',
  url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
  body: { chat_id: chatId, text },
  json: true,
});

// 1. Reclamar el lock -- PATCH condicional: solo pega si locked_at sigue
// NULL. Si la respuesta viene vac?a, alguien m?s ya lo tom? -- se aborta
// sin tocar nada m?s.
const claimed = await this.helpers.httpRequest({
  method: 'PATCH',
  url: `${SUPABASE_URL}/rest/v1/publications?id=eq.${pub.id}&locked_at=is.null`,
  headers: SUPABASE_HEADERS,
  body: { locked_at: new Date().toISOString(), locked_by: WORKER_ID },
  json: true,
});

if (!Array.isArray(claimed) || claimed.length === 0) {
  return [{ json: { publication_id: pub.id, outcome: 'skipped_already_locked' } }];
}

// 2. Idempotencia real: si por lo que sea esta fila ya tiene
// external_post_id, ya se public? -- no se vuelve a llamar al proveedor
// aunque el lock se haya podido tomar (ej. un estado inconsistente
// despu?s de un fallo a mitad de camino).
const current = claimed[0];
if (current.external_post_id) {
  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/publications?id=eq.${pub.id}`,
    headers: SUPABASE_HEADERS,
    body: { locked_at: null, locked_by: null },
    json: true,
  });
  return [{ json: { publication_id: pub.id, outcome: 'already_published', external_post_id: current.external_post_id } }];
}

// 3. Traer el video y la cuenta destino.
const renders = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/renders?id=eq.${pub.render_id}&select=public_url,status`,
  headers: SUPABASE_HEADERS,
  json: true,
});
const render = renders[0];

const accounts = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/social_accounts?id=eq.${pub.account_id}&select=external_account_id,status`,
  headers: SUPABASE_HEADERS,
  json: true,
});
const account = accounts[0];

if (!render || render.status !== 'done' || !account || account.status !== 'active') {
  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/publications?id=eq.${pub.id}`,
    headers: SUPABASE_HEADERS,
    body: {
      status: 'failed',
      error_message: !render || render.status !== 'done' ? 'El render asociado ya no est? disponible' : 'La cuenta se desconect? despu?s de programar la publicaci?n',
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    },
    json: true,
  });
  return [{ json: { publication_id: pub.id, outcome: 'failed_missing_dependency' } }];
}

// 4. Publicar.
await this.helpers.httpRequest({
  method: 'PATCH',
  url: `${SUPABASE_URL}/rest/v1/publications?id=eq.${pub.id}`,
  headers: SUPABASE_HEADERS,
  body: { status: 'publishing', updated_at: new Date().toISOString() },
  json: true,
});

const job = {
  publication_id: pub.id,
  client_id: pub.client_id,
  platform: pub.platform,
  provider: pub.provider,
  account_external_id: account.external_account_id,
  video_url: render.public_url,
  caption: pub.caption_used,
  scheduled_at: null, // publicaci?n inmediata: n8n ya esper? hasta scheduled_at antes de tomar esta fila
};

let result;
try {
  result = await this.helpers.httpRequest({
    method: 'POST',
    url: `${PUBLISH_API_URL}/publish`,
    body: job,
    json: true,
  });
} catch (err) {
  result = { ok: false, status: 'rate_limited', error_message: `publish-api inaccesible: ${String(err)}`, retryable: true, provider_post_id: null, provider_status: null, published_at: null, scheduled_at: null };
}

// 5. Guardar resultado + liberar el lock.
if (result.ok && (result.status === 'published' || result.status === 'scheduled')) {
  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/publications?id=eq.${pub.id}`,
    headers: SUPABASE_HEADERS,
    body: {
      status: result.status,
      external_post_id: result.provider_post_id,
      provider_status: result.provider_status,
      published_at: result.published_at,
      error_message: null,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    },
    json: true,
  });

  const chatIdRows = await this.helpers.httpRequest({
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/clients?id=eq.${pub.client_id}&select=telegram_chat_id`,
    headers: SUPABASE_HEADERS,
    json: true,
  });
  const chatId = (chatIdRows[0] && chatIdRows[0].telegram_chat_id) || cfg.TELEGRAM_CHAT_ID;
  const label = result.status === 'published' ? '?? Publicado' : '??? Programado';
  await sendTelegram(chatId, `${label} en ${pub.platform} -- ID del proveedor: ${result.provider_post_id}`);

  return [{ json: { publication_id: pub.id, outcome: result.status } }];
}

// Fallo: decidir si reintenta o queda terminal.
const nextAttempts = (pub.retry_count || 0) + 1;
const isTerminal = !result.retryable || nextAttempts >= MAX_ATTEMPTS;
const backoffMinutes = Math.pow(3, nextAttempts); // 3, 9, 27 minutos

await this.helpers.httpRequest({
  method: 'PATCH',
  url: `${SUPABASE_URL}/rest/v1/publications?id=eq.${pub.id}`,
  headers: SUPABASE_HEADERS,
  body: {
    status: isTerminal ? 'failed' : 'ready_to_schedule',
    error_message: result.error_message,
    provider_status: result.provider_status,
    retry_count: nextAttempts,
    next_attempt_at: isTerminal ? null : new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString(),
    locked_at: null,
    locked_by: null,
    updated_at: new Date().toISOString(),
  },
  json: true,
});

if (isTerminal) {
  const chatIdRows = await this.helpers.httpRequest({
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/clients?id=eq.${pub.client_id}&select=telegram_chat_id`,
    headers: SUPABASE_HEADERS,
    json: true,
  });
  const chatId = (chatIdRows[0] && chatIdRows[0].telegram_chat_id) || cfg.TELEGRAM_CHAT_ID;
  await sendTelegram(chatId, `? No se pudo publicar en ${pub.platform} despu?s de ${nextAttempts} intentos.\nError: ${result.error_message}`);
}

return [{ json: { publication_id: pub.id, outcome: isTerminal ? 'failed' : 'retry_scheduled', attempt: nextAttempts } }];
