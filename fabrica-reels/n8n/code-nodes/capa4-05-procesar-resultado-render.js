/**
 * Nodo n8n: "5. Procesar resultado de render"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 * Disparado por el Webhook "Recibir resultado de render", que recibe el
 * POST que hace renderService cuando termina (bien o mal) un render.
 *
 * Deja preparado el texto y los botones inline de Telegram para el
 * siguiente nodo -- éxito y fallo comparten un único mensaje de salida
 * con distinto contenido, para no necesitar un IF en este tramo.
 *
 * Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
// El nodo Webhook de n8n entrega el body del POST bajo $json.body en la
// mayoría de las versiones/configuraciones; esta línea cubre también el
// caso en que tu instancia lo entrega ya aplanado en $json directamente.
const payload = $json.body || $json;

const SUPABASE_URL = $env.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: $env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

let text;
let replyMarkup;

if (payload.status === 'done') {
  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${payload.raw_video_id}`,
    headers: SUPABASE_HEADERS,
    body: { status: 'rendered_pending_review' },
    json: true,
  });

  text = [
    `🎬 Render listo -- ${payload.video_id}`,
    `Tiempo de render: ${Number(payload.render_time_sec).toFixed(1)}s`,
    '',
    `Ver video: ${payload.public_url}`,
    '',
    '¿Qué hacemos con este video?',
  ].join('\n');

  replyMarkup = {
    inline_keyboard: [[
      { text: '✅ Aprobar', callback_data: `appr:${payload.render_id}` },
      { text: '❌ Rechazar', callback_data: `rejt:${payload.render_id}` },
      { text: '🔁 Pedir variante', callback_data: `varr:${payload.render_id}` },
    ]],
  };
} else {
  const failedStatus = payload.stage === 'upload' ? 'failed_upload' : 'failed_render';

  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${payload.raw_video_id}`,
    headers: SUPABASE_HEADERS,
    body: { status: failedStatus },
    json: true,
  });

  text = [
    `❌ Falló el render -- raw_video ${payload.raw_video_id}`,
    `Etapa: ${payload.stage === 'upload' ? 'subida a Storage' : 'render con Remotion'}`,
    `Error: ${payload.error}`,
  ].join('\n');

  replyMarkup = {
    inline_keyboard: [[
      { text: '🔁 Reintentar', callback_data: `retr:${payload.raw_video_id}` },
    ]],
  };
}

return [{
  json: {
    ...payload,
    telegram_text: text,
    telegram_reply_markup: JSON.stringify(replyMarkup),
  },
}];
