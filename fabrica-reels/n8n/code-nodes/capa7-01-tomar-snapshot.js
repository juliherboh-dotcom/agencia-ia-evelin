const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "1. Tomar snapshot y guardar"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * Llama a metrics-api para la ventana correspondiente, hace un chequeo
 * de plausibilidad, y guarda en post_metrics. Si el provider no tiene
 * ciertos campos (ej. saves/retenci?n en TikTok), se guardan como NULL,
 * nunca como 0 -- la diferencia importa para el scoring (Capa 8): NULL
 * redistribuye peso, 0 ser?a "lo midieron y dio cero", que es otra cosa.
 *
 * Campos de 0. Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * METRICS_API_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};
const METRICS_API_URL = cfg.METRICS_API_URL;

const item = $json;

// Idempotencia defensiva: aunque el nodo 0 ya filtra, una carrera entre
// dos ciclos podr?a duplicar -- el ?ndice ?nico de la migraci?n es la
// ?ltima l?nea de defensa, esto evita gastar la llamada al provider de m?s.
const already = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/post_metrics?publication_id=eq.${item.publication_id}&snapshot_window=eq.${item.window}&select=id`,
  headers: SUPABASE_HEADERS,
  json: true,
});
if (already.length > 0) {
  return [{ json: { ...item, outcome: 'already_exists' } }];
}

const publications = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/publications?id=eq.${item.publication_id}&select=external_post_id,provider`,
  headers: SUPABASE_HEADERS,
  json: true,
});
const pub = publications[0];
if (!pub || !pub.external_post_id) {
  return [{ json: { ...item, outcome: 'skipped_no_external_id' } }];
}

let snapshot;
try {
  snapshot = await this.helpers.httpRequest({
    method: 'POST',
    url: `${METRICS_API_URL}/snapshot`,
    body: {
      publication_id: item.publication_id,
      platform: item.platform,
      provider: pub.provider,
      provider_post_id: pub.external_post_id,
      window: item.window,
    },
    json: true,
  });
} catch (err) {
  return [{ json: { ...item, outcome: 'provider_unreachable', error: String(err) } }];
}

if (!snapshot.ok) {
  if (snapshot.retryable) {
    return [{ json: { ...item, outcome: 'retry_next_cycle', error: snapshot.error_message } }];
  }
  // Fallo terminal del provider (ej. "publicaci?n removida"): se guarda
  // igual una fila con source='failed' para no reintentar esta ventana
  // para siempre y dejar rastro de qu? pas?.
  await this.helpers.httpRequest({
    method: 'POST',
    url: `${SUPABASE_URL}/rest/v1/post_metrics`,
    headers: SUPABASE_HEADERS,
    body: {
      publication_id: item.publication_id,
      client_id: item.client_id,
      raw_video_id: item.raw_video_id,
      render_id: item.render_id,
      account_id: item.account_id,
      platform: item.platform,
      snapshot_window: item.window,
      snapshot_at: new Date().toISOString(),
      source: 'failed',
      confidence_level: 'low',
      raw_payload: { error: snapshot.error_message },
    },
    json: true,
  });
  return [{ json: { ...item, outcome: 'failed_terminal', error: snapshot.error_message } }];
}

// Chequeo de valores imposibles: negativos, o engagement absurdamente por
// encima de las views (indicio de un bug del proveedor, no un dato real).
const numericFields = [snapshot.views, snapshot.likes, snapshot.comments, snapshot.shares, snapshot.saves, snapshot.follows];
const looksImplausible =
  numericFields.some((v) => typeof v === 'number' && v < 0) ||
  (snapshot.views !== null && (snapshot.likes || 0) > snapshot.views * 5);

await this.helpers.httpRequest({
  method: 'POST',
  url: `${SUPABASE_URL}/rest/v1/post_metrics`,
  headers: SUPABASE_HEADERS,
  body: {
    publication_id: item.publication_id,
    client_id: item.client_id,
    raw_video_id: item.raw_video_id,
    render_id: item.render_id,
    account_id: item.account_id,
    platform: item.platform,
    snapshot_window: item.window,
    snapshot_at: new Date().toISOString(),
    views: snapshot.views,
    likes: snapshot.likes,
    comments: snapshot.comments,
    shares: snapshot.shares,
    saves: snapshot.saves,
    follows: snapshot.follows,
    profile_visits: snapshot.profile_visits,
    avg_watch_time: snapshot.avg_watch_time_sec,
    retention_rate: snapshot.retention_rate,
    completion_rate: snapshot.completion_rate,
    engagement_rate: snapshot.views
      ? ((snapshot.likes || 0) + (snapshot.comments || 0) + (snapshot.shares || 0) + (snapshot.saves || 0)) / snapshot.views
      : null,
    raw_payload: snapshot.raw_payload,
    source: snapshot.source,
    confidence_level: looksImplausible ? 'low' : snapshot.confidence_level,
  },
  json: true,
});

if (looksImplausible) {
  await this.helpers.httpRequest({
    method: 'POST',
    url: `https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}/sendMessage`,
    body: {
      chat_id: cfg.TELEGRAM_CHAT_ID,
      text: `?? M?tricas con valores poco plausibles para publication ${item.publication_id} (${item.window}) -- revisar manualmente.\nraw: ${JSON.stringify(snapshot).slice(0, 300)}`,
    },
    json: true,
  });
}

return [{ json: { ...item, outcome: 'saved' } }];
