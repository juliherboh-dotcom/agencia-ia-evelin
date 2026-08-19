const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "99. Marcar generacion fallida"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 * Recibe el error output de los nodos Code de Capa 9.
 */
const SUPABASE_URL = cfg.SUPABASE_URL;
const rawVideoId = $json.raw_video?.id || $json.raw_video_id || $json.id;
if (!rawVideoId) throw new Error(`No se pudo identificar raw_video al manejar el error: ${JSON.stringify($json)}`);
const message = String($json.error?.message || $json.error || $json.message || 'Error no especificado en Capa 9').slice(0, 2000);
const headers = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

await this.helpers.httpRequest({
  method: 'PATCH',
  url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${rawVideoId}`,
  headers,
  body: { variant_generation_status: 'failed', variant_generation_error: message },
  json: true,
});

try {
  await this.helpers.httpRequest({
    method: 'POST',
    url: `https://api.telegram.org/bot${cfg.TELEGRAM_BOT_TOKEN}/sendMessage`,
    body: { chat_id: cfg.TELEGRAM_CHAT_ID, text: `Fallo Capa 9 para ${rawVideoId}: ${message}` },
    json: true,
  });
} catch (_) { /* el estado de error en Supabase es la fuente de verdad */ }

return [{ json: { raw_video_id: rawVideoId, outcome: 'failed', error: message } }];
