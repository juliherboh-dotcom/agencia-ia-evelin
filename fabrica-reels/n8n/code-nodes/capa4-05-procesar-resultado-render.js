const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "5. Procesar resultado de render"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 * Disparado por el Webhook "Recibir resultado de render".
 *
 * AJUSTE DE CAPA 5: este nodo ya NO manda el mensaje interactivo de
 * revisi?n (con botones aprobar/rechazar/etc.) -- esa responsabilidad
 * pas? al poller propio de Capa 5
 * (capa5-00-enviar-revisiones-pendientes.js), que es quien de verdad
 * posee el flujo de revisi?n. Ac? solo se actualiza el estado y, si el
 * render FALL?, se avisa -- un fallo de render es un tema operativo de
 * Capa 4, no un tema editorial de Capa 5.
 *
 * Campos de 0. Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
const payload = $json.body || $json;

const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

if (payload.status === 'done') {
  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${payload.raw_video_id}`,
    headers: SUPABASE_HEADERS,
    body: { status: 'rendered_pending_review' },
    json: true,
  });
  return [{ json: { ...payload, handled: true } }];
}

const failedStatus = payload.stage === 'upload' ? 'failed_upload' : 'failed_render';

await this.helpers.httpRequest({
  method: 'PATCH',
  url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${payload.raw_video_id}`,
  headers: SUPABASE_HEADERS,
  body: { status: failedStatus },
  json: true,
});

const text = [
  `? Fall? el render -- raw_video ${payload.raw_video_id}`,
  `Etapa: ${payload.stage === 'upload' ? 'subida a Storage' : 'render con Remotion'}`,
  `Error: ${payload.error}`,
].join('\n');

// Llamada directa a la Bot API de Telegram (no nodo nativo) -- el bot?n
// "retr:<raw_video_id>" lo procesa el router de Capa 5
// (capa5-02-rutear-interaccion.js), que es quien escucha callback_query
// desde este punto en adelante.
await this.helpers.httpRequest({
  method: 'POST',
  url: `https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}/sendMessage`,
  body: {
    chat_id: cfg.TELEGRAM_CHAT_ID,
    text,
    reply_markup: { inline_keyboard: [[{ text: '?? Reintentar', callback_data: `retr:${payload.raw_video_id}` }]] },
  },
  json: true,
});

return [{ json: { ...payload, handled: true, failed_status: failedStatus } }];
