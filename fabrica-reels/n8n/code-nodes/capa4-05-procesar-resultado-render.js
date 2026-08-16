/**
 * Nodo n8n: "5. Procesar resultado de render"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 * Disparado por el Webhook "Recibir resultado de render".
 *
 * AJUSTE DE CAPA 5: este nodo ya NO manda el mensaje interactivo de
 * revisión (con botones aprobar/rechazar/etc.) -- esa responsabilidad
 * pasó al poller propio de Capa 5
 * (capa5-00-enviar-revisiones-pendientes.js), que es quien de verdad
 * posee el flujo de revisión. Acá solo se actualiza el estado y, si el
 * render FALLÓ, se avisa -- un fallo de render es un tema operativo de
 * Capa 4, no un tema editorial de Capa 5.
 *
 * Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
const payload = $json.body || $json;

const SUPABASE_URL = $env.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: $env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`,
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
  `❌ Falló el render -- raw_video ${payload.raw_video_id}`,
  `Etapa: ${payload.stage === 'upload' ? 'subida a Storage' : 'render con Remotion'}`,
  `Error: ${payload.error}`,
].join('\n');

// Llamada directa a la Bot API de Telegram (no nodo nativo) -- el botón
// "retr:<raw_video_id>" lo procesa el router de Capa 5
// (capa5-02-rutear-interaccion.js), que es quien escucha callback_query
// desde este punto en adelante.
await this.helpers.httpRequest({
  method: 'POST',
  url: `https://api.telegram.org/bot${$env.TELEGRAM_BOT_TOKEN}/sendMessage`,
  body: {
    chat_id: $env.TELEGRAM_CHAT_ID,
    text,
    reply_markup: { inline_keyboard: [[{ text: '🔁 Reintentar', callback_data: `retr:${payload.raw_video_id}` }]] },
  },
  json: true,
});

return [{ json: { ...payload, handled: true, failed_status: failedStatus } }];
