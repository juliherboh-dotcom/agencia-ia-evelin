const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "0. Enviar revisiones pendientes"
 * Tipo: Code (JavaScript, "Run Once for All Items")
 *
 * Busca raw_videos en rendered_pending_review que todav?a no recibieron
 * el mensaje interactivo de revisi?n (review_prompt_sent_at IS NULL),
 * arma el mensaje con el link firmado y los 7 botones de acci?n, y lo
 * manda por Telegram v?a HTTP directo a la Bot API (no v?a nodo nativo --
 * m?s robusto entre versiones de n8n, mismo patr?n que Capa 3/4).
 *
 * Campos de 0. Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (fallback si el cliente no tiene
 * telegram_chat_id propio configurado)
 */
const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};
const TELEGRAM_BOT_TOKEN = cfg.TELEGRAM_BOT_TOKEN;

const sendTelegramMessage = async (chatId, text, replyMarkup) => {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return this.helpers.httpRequest({
    method: 'POST',
    url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    body,
    json: true,
  });
};

const pending = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/raw_videos?status=eq.rendered_pending_review&review_prompt_sent_at=is.null&select=id,client_id`,
  headers: SUPABASE_HEADERS,
  json: true,
});

const results = [];

for (const rawVideo of pending) {
  const renders = await this.helpers.httpRequest({
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/renders?raw_video_id=eq.${rawVideo.id}&status=eq.done&order=created_at.desc&limit=1&select=id,public_url,render_time_sec`,
    headers: SUPABASE_HEADERS,
    json: true,
  });
  const render = renders[0];
  if (!render) continue; // defensivo: no deber?a pasar si el estado es consistente

  const clients = await this.helpers.httpRequest({
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/clients?id=eq.${rawVideo.client_id}&select=telegram_chat_id`,
    headers: SUPABASE_HEADERS,
    json: true,
  });
  const chatId = (clients[0] && clients[0].telegram_chat_id) || cfg.TELEGRAM_CHAT_ID;

  const text = [
    '?? <b>Video listo para revisar</b>',
    `Ver: ${render.public_url}`,
    `Tiempo de render: ${Number(render.render_time_sec || 0).toFixed(1)}s`,
    '',
    '?Qu? hacemos con este video?',
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '? Aprobar', callback_data: `appr:${render.id}` },
        { text: '? Rechazar', callback_data: `rejt:${render.id}` },
      ],
      [
        { text: '?? Variante autom?tica', callback_data: `varr:${render.id}` },
        { text: '?? Pedir cambios', callback_data: `chng:${render.id}` },
      ],
      [
        { text: '?? Regenerar link', callback_data: `rlnk:${render.id}` },
        { text: '?? Volver a renderizar', callback_data: `rrnd:${render.id}` },
      ],
      [{ text: '?? Marcar como error', callback_data: `errf:${render.id}` }],
    ],
  };

  await sendTelegramMessage(chatId, text, replyMarkup);

  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${rawVideo.id}`,
    headers: SUPABASE_HEADERS,
    body: { review_prompt_sent_at: new Date().toISOString() },
    json: true,
  });

  results.push({ raw_video_id: rawVideo.id, render_id: render.id, chat_id: chatId });
}

return results.map((r) => ({ json: r }));
