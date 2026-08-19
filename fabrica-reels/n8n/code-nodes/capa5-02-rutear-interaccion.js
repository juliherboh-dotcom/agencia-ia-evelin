const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "2. Rutear interacci?n de revisi?n"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 * Disparado por el Telegram Trigger "Recibir interacciones de revisi?n"
 * (updates: callback_query, message). Es el ?nico nodo de todo el
 * workflow -- hace TODAS las llamadas (Supabase + Telegram Bot API)
 * directamente, sin depender de nodos nativos de Telegram, para no
 * arrastrar incertidumbre de nombres de par?metros entre versiones de
 * n8n (mismo criterio que el resto de la F?brica de Reels).
 *
 * callback_data soportado:
 *   appr:<render_id>          aprobar (inmediato)
 *   rejt:<render_id>          rechazar (pide comentario)
 *   chng:<render_id>          pedir cambios manuales (pide comentario)
 *   errf:<render_id>          marcar como error (pide comentario obligatorio)
 *   varr:<render_id>          pedir variante autom?tica (pide tipo primero)
 *   vt:<code>:<render_id>     tipo de variante elegido (pide comentario opcional)
 *   rlnk:<render_id>          regenerar link de revisi?n (utilitario, sin sesi?n)
 *   rrnd:<render_id>          volver a renderizar un video ya aprobado/revisado
 *   retr:<raw_video_id>       reintentar un render que FALL? (viene de Capa 4)
 *
 * Campos de 0. Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * TELEGRAM_BOT_TOKEN, RENDER_SERVICE_URL
 */
const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};
const TELEGRAM_BOT_TOKEN = cfg.TELEGRAM_BOT_TOKEN;
const RENDER_SERVICE_URL = cfg.RENDER_SERVICE_URL;

const VARIANT_TYPES = {
  nh: 'nuevo_hook',
  sa: 'subtitulos_agresivos',
  vc: 'version_mas_corta',
  vl: 'version_mas_limpia',
  ct: 'cambio_de_template',
  cx: 'correccion_de_texto',
};

const REQUIRES_PENDING = ['appr', 'rejt', 'chng', 'errf', 'varr', 'rrnd', 'vt'];

// ---------- helpers de bajo nivel ----------

const tg = {
  send: (chatId, text, replyMarkup) => this.helpers.httpRequest({
    method: 'POST',
    url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    body: { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: replyMarkup },
    json: true,
  }),
  editText: (chatId, messageId, text, replyMarkup) => this.helpers.httpRequest({
    method: 'POST',
    url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`,
    body: { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: replyMarkup },
    json: true,
  }),
  answerCallback: (callbackQueryId, text) => this.helpers.httpRequest({
    method: 'POST',
    url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
    body: { callback_query_id: callbackQueryId, text },
    json: true,
  }),
};

// answerCallbackQuery vence a los pocos segundos ("Telegram callback
// vencido") -- si falla, no es cr?tico: la decisi?n ya se guarda en
// Supabase igual, as? que nunca dejamos que esto tumbe el resto del flujo.
const safeAnswerCallback = async (id, text) => {
  try {
    await tg.answerCallback(id, text);
  } catch (err) {
    // ignorado a prop?sito
  }
};

const sb = {
  get: (query) => this.helpers.httpRequest({ method: 'GET', url: `${SUPABASE_URL}/rest/v1/${query}`, headers: SUPABASE_HEADERS, json: true }),
  patch: (query, body) => this.helpers.httpRequest({ method: 'PATCH', url: `${SUPABASE_URL}/rest/v1/${query}`, headers: SUPABASE_HEADERS, body, json: true }),
  post: (table, body) => this.helpers.httpRequest({ method: 'POST', url: `${SUPABASE_URL}/rest/v1/${table}`, headers: SUPABASE_HEADERS, body, json: true }),
};

// ---------- permisos ----------

const checkPermissionByRender = async (renderId, telegramUserId) => {
  const renders = await sb.get(`renders?id=eq.${renderId}&select=id,raw_video_id`);
  const render = renders[0];
  if (!render) return { ok: false, reason: 'render_not_found' };

  const rawVideos = await sb.get(`raw_videos?id=eq.${render.raw_video_id}&select=id,client_id,status`);
  const rawVideo = rawVideos[0];
  if (!rawVideo) return { ok: false, reason: 'raw_video_not_found' };

  const reviewers = await sb.get(`reviewers?client_id=eq.${rawVideo.client_id}&telegram_user_id=eq.${telegramUserId}&active=eq.true&select=id`);
  if (reviewers.length === 0) return { ok: false, reason: 'not_a_reviewer' };

  return { ok: true, render: { ...render, raw_video: rawVideo } };
};

const checkPermissionByRawVideo = async (rawVideoId, telegramUserId) => {
  const rawVideos = await sb.get(`raw_videos?id=eq.${rawVideoId}&select=id,client_id,status`);
  const rawVideo = rawVideos[0];
  if (!rawVideo) return { ok: false, reason: 'raw_video_not_found' };

  const reviewers = await sb.get(`reviewers?client_id=eq.${rawVideo.client_id}&telegram_user_id=eq.${telegramUserId}&active=eq.true&select=id`);
  if (reviewers.length === 0) return { ok: false, reason: 'not_a_reviewer' };

  return { ok: true, raw_video: rawVideo };
};

const PERMISSION_MESSAGES = {
  render_not_found: '?? No encontr? este render en la base de datos.',
  raw_video_not_found: '?? No encontr? el video asociado.',
  not_a_reviewer: '?? No ten?s permiso para revisar videos de este cliente.',
};

// ---------- acciones que finalizan de inmediato ----------

const createPublicationJob = async (render) => {
  const editSpecs = await sb.get(`edit_specs?raw_video_id=eq.${render.raw_video_id}&order=version.desc&limit=1&select=spec_json`);
  const spec = editSpecs[0] ? editSpecs[0].spec_json : null;

  const assetsRows = await sb.get(`assets?raw_video_id=eq.${render.raw_video_id}&select=captions_ig,captions_tiktok,hashtags`);
  const assets = assetsRows[0] || {};

  const platform = (spec && spec.platform) || 'instagram_reels';
  const caption = platform === 'tiktok'
    ? (assets.captions_tiktok && assets.captions_tiktok[0])
    : (assets.captions_ig && assets.captions_ig[0]);

  // `publications` ya existe desde la arquitectura original (Capa 6) --
  // ac? solo se puebla, no se crea una tabla `publish_jobs` nueva.
  await sb.post('publications', {
    render_id: render.id,
    raw_video_id: render.raw_video_id,
    client_id: render.raw_video.client_id,
    platform,
    caption_used: caption || null,
    hashtags_used: (assets.hashtags || []).join(' '),
    status: 'queued',
  });
};

const finalizeImmediate = async (render, rawVideoStatus, decision, reviewer, chatId, messageId, callbackQueryId, toastText) => {
  await sb.post('review_actions', { render_id: render.id, reviewer, decision, decided_at: new Date().toISOString() });
  await sb.patch(`raw_videos?id=eq.${render.raw_video_id}`, { status: rawVideoStatus });

  if (decision === 'approved') {
    await createPublicationJob(render);
  }

  await safeAnswerCallback(callbackQueryId, toastText);
  await tg.editText(chatId, messageId, `${toastText} por ${reviewer}`, null);

  return [{ json: { skip: false, render_id: render.id, decision } }];
};

const finalizeRerender = async (render, reviewer, chatId, messageId, callbackQueryId) => {
  await sb.post('review_actions', { render_id: render.id, reviewer, decision: 'rerender_requested', decided_at: new Date().toISOString() });
  await sb.patch(`raw_videos?id=eq.${render.raw_video_id}`, { status: 'edit_spec_ready', render_attempts: 0, review_prompt_sent_at: null });

  await safeAnswerCallback(callbackQueryId, '?? Reencolado para renderizar de nuevo');
  await tg.editText(chatId, messageId, `?? Reencolado para renderizar de nuevo por ${reviewer}`, null);
  return [{ json: { skip: false, render_id: render.id, decision: 'rerender_requested' } }];
};

const finalizeRetry = async (rawVideoId, reviewer, chatId, messageId, callbackQueryId) => {
  await sb.patch(`raw_videos?id=eq.${rawVideoId}`, { status: 'edit_spec_ready', render_attempts: 0 });
  await safeAnswerCallback(callbackQueryId, '?? Reintento encolado');
  await tg.editText(chatId, messageId, `?? Reintento encolado por ${reviewer}`, null);
  return [{ json: { skip: false, raw_video_id: rawVideoId, decision: 'retry_requested' } }];
};

const regenerateLink = async (render, chatId, callbackQueryId) => {
  let newUrl;
  try {
    const result = await this.helpers.httpRequest({
      method: 'POST',
      url: `${RENDER_SERVICE_URL}/renders/${render.id}/refresh-link`,
      json: true,
    });
    newUrl = result.public_url;
  } catch (err) {
    await safeAnswerCallback(callbackQueryId, '?? No se pudo regenerar el link, prob? de nuevo en un momento.');
    return [{ json: { skip: true, reason: 'refresh_link_failed', error: String(err) } }];
  }

  await safeAnswerCallback(callbackQueryId, '?? Link regenerado');
  await tg.send(chatId, `?? Nuevo link de revisi?n (v?lido 7 d?as m?s): ${newUrl}`);
  return [{ json: { skip: false, render_id: render.id, decision: 'link_regenerated' } }];
};

// ---------- acciones que abren una sesi?n de comentario ----------

const startCommentSession = async (render, pendingAction, reviewerTelegramId, chatId, messageId, callbackQueryId) => {
  const promptText = pendingAction === 'error_flagged'
    ? '?? Contame QU? est? mal (obligatorio) respondiendo a este mensaje:'
    : '?? Contame el motivo (o escrib? "skip" para no dejar comentario) respondiendo a este mensaje:';

  const sentPrompt = await tg.send(chatId, promptText);

  await sb.post('review_sessions', {
    render_id: render.id,
    raw_video_id: render.raw_video_id,
    chat_id: String(chatId),
    reviewer_telegram_user_id: reviewerTelegramId,
    pending_action: pendingAction,
    status: 'awaiting_comment',
    prompt_message_id: String(sentPrompt.result.message_id),
  });

  await safeAnswerCallback(callbackQueryId, 'Esperando tu comentario');
  await tg.editText(chatId, messageId, `? Esperando comentario para "${pendingAction}"...`, null);

  return [{ json: { skip: false, render_id: render.id, pending_action: pendingAction, status: 'awaiting_comment' } }];
};

const startVariantTypeSelection = async (render, reviewerTelegramId, chatId, messageId, callbackQueryId) => {
  const replyMarkup = {
    inline_keyboard: [
      [{ text: 'Nuevo hook', callback_data: `vt:nh:${render.id}` }, { text: 'Subt?tulos m?s agresivos', callback_data: `vt:sa:${render.id}` }],
      [{ text: 'Versi?n m?s corta', callback_data: `vt:vc:${render.id}` }, { text: 'Versi?n m?s limpia', callback_data: `vt:vl:${render.id}` }],
      [{ text: 'Cambio de template (futuro)', callback_data: `vt:ct:${render.id}` }, { text: 'Correcci?n de texto', callback_data: `vt:cx:${render.id}` }],
    ],
  };

  await sb.post('review_sessions', {
    render_id: render.id,
    raw_video_id: render.raw_video_id,
    chat_id: String(chatId),
    reviewer_telegram_user_id: reviewerTelegramId,
    pending_action: 'variant_requested',
    status: 'awaiting_variant_type',
  });

  await safeAnswerCallback(callbackQueryId, 'Eleg? el tipo de variante');
  await tg.editText(chatId, messageId, '?Qu? tipo de variante quer?s?', replyMarkup);

  return [{ json: { skip: false, render_id: render.id, status: 'awaiting_variant_type' } }];
};

const chooseVariantType = async (renderId, code, reviewerTelegramId, chatId, messageId, callbackQueryId) => {
  const variantType = VARIANT_TYPES[code] || 'sin_especificar';

  const sessions = await sb.get(`review_sessions?render_id=eq.${renderId}&status=eq.awaiting_variant_type&reviewer_telegram_user_id=eq.${reviewerTelegramId}&order=created_at.desc&limit=1&select=id`);
  const session = sessions[0];
  if (!session) {
    await safeAnswerCallback(callbackQueryId, '?? Esta sesi?n ya no est? activa (?expir? o ya se resolvi??).');
    return [{ json: { skip: true, reason: 'session_not_found' } }];
  }

  const sentPrompt = await tg.send(chatId, '?? Contame en una frase qu? ten?s en mente para esta variante (o escrib? "skip" para no dejar comentario):');

  await sb.patch(`review_sessions?id=eq.${session.id}`, {
    variant_type: variantType,
    status: 'awaiting_comment',
    prompt_message_id: String(sentPrompt.result.message_id),
    updated_at: new Date().toISOString(),
  });

  await safeAnswerCallback(callbackQueryId, `Variante: ${variantType}`);
  await tg.editText(chatId, messageId, `? Variante "${variantType}" -- esperando tu comentario...`, null);

  return [{ json: { skip: false, render_id: renderId, variant_type: variantType, status: 'awaiting_comment' } }];
};

// ---------- finalizaci?n de sesiones de comentario ----------

const finalizeWithComment = async (session, comment, chatId) => {
  const decisionMap = {
    reject: 'rejected',
    needs_changes: 'needs_changes',
    variant_requested: 'variant_requested',
    error_flagged: 'error_flagged',
  };
  const decision = decisionMap[session.pending_action] || session.pending_action;
  const reviewer = `telegram:${session.reviewer_telegram_user_id}`;

  await sb.post('review_actions', {
    render_id: session.render_id,
    reviewer,
    decision,
    variant_type: session.variant_type || null,
    comment,
    session_id: session.id,
    decided_at: new Date().toISOString(),
  });

  await sb.patch(`raw_videos?id=eq.${session.raw_video_id}`, { status: decision });
  await sb.patch(`review_sessions?id=eq.${session.id}`, { status: 'completed', updated_at: new Date().toISOString() });

  const labelMap = {
    rejected: '? Rechazado',
    needs_changes: '?? Cambios solicitados',
    variant_requested: '?? Variante solicitada',
    error_flagged: '?? Marcado como error',
  };

  await tg.send(chatId, `${labelMap[decision] || decision} -- registrado. ${comment ? `Comentario: "${comment}"` : 'Sin comentario.'}`);

  return [{ json: { skip: false, render_id: session.render_id, decision, comment } }];
};

const handleTextMessage = async (message) => {
  const chatId = String(message.chat.id);
  const text = message.text.trim();

  const sessions = await sb.get(`review_sessions?chat_id=eq.${chatId}&status=eq.awaiting_comment&order=created_at.desc&limit=1&select=id,render_id,raw_video_id,pending_action,variant_type,reviewer_telegram_user_id`);
  const session = sessions[0];
  if (!session) {
    // No hay ninguna revisi?n esperando comentario en este chat -- se ignora.
    return [{ json: { skip: true, reason: 'no_active_session' } }];
  }

  if (session.pending_action === 'error_flagged' && /^(skip|-)$/i.test(text)) {
    await tg.send(chatId, '?? "Marcar como error" necesita una descripci?n -- contame qu? est? mal, no puede quedar vac?o.');
    return [{ json: { skip: true, reason: 'comment_required' } }];
  }

  const comment = /^(skip|-)$/i.test(text) ? null : text;
  return finalizeWithComment(session, comment, chatId);
};

// ---------- dispatcher de callback_query ----------

const handleCallbackQuery = async (cbq) => {
  const [action, a, b] = (cbq.data || '').split(':');
  const chatId = cbq.message.chat.id;
  const messageId = cbq.message.message_id;
  const reviewerTelegramId = String(cbq.from.id);
  const reviewer = cbq.from.username ? `telegram:@${cbq.from.username}` : `telegram:${reviewerTelegramId}`;

  if (action === 'retr') {
    const rawVideoId = a;
    const permission = await checkPermissionByRawVideo(rawVideoId, reviewerTelegramId);
    if (!permission.ok) {
      await safeAnswerCallback(cbq.id, PERMISSION_MESSAGES[permission.reason] || '?? Error de permisos.');
      return [{ json: { skip: true, reason: permission.reason } }];
    }
    return finalizeRetry(rawVideoId, reviewer, chatId, messageId, cbq.id);
  }

  const renderId = action === 'vt' ? b : a;
  const permission = await checkPermissionByRender(renderId, reviewerTelegramId);
  if (!permission.ok) {
    await safeAnswerCallback(cbq.id, PERMISSION_MESSAGES[permission.reason] || '?? Error de permisos.');
    return [{ json: { skip: true, reason: permission.reason, render_id: renderId } }];
  }
  const render = permission.render;

  if (REQUIRES_PENDING.includes(action) && render.raw_video.status !== 'rendered_pending_review') {
    await safeAnswerCallback(cbq.id, `?? Este video ya fue procesado (estado actual: ${render.raw_video.status}).`);
    return [{ json: { skip: true, reason: 'already_decided', current_status: render.raw_video.status } }];
  }

  if (action === 'appr') return finalizeImmediate(render, 'approved_for_publish', 'approved', reviewer, chatId, messageId, cbq.id, '? Aprobado');
  if (action === 'rrnd') return finalizeRerender(render, reviewer, chatId, messageId, cbq.id);
  if (action === 'rlnk') return regenerateLink(render, chatId, cbq.id);

  if (action === 'rejt' || action === 'chng' || action === 'errf') {
    const pendingAction = { rejt: 'reject', chng: 'needs_changes', errf: 'error_flagged' }[action];
    return startCommentSession(render, pendingAction, reviewerTelegramId, chatId, messageId, cbq.id);
  }

  if (action === 'varr') return startVariantTypeSelection(render, reviewerTelegramId, chatId, messageId, cbq.id);
  if (action === 'vt') return chooseVariantType(renderId, a, reviewerTelegramId, chatId, messageId, cbq.id);

  await safeAnswerCallback(cbq.id, 'Acci?n no reconocida');
  return [{ json: { skip: true, reason: 'unknown_action', raw_action: cbq.data } }];
};

// ---------- entrada ----------

// El Telegram Trigger de n8n entrega el Update de Telegram directo como
// $json (a diferencia del nodo Webhook gen?rico, que lo envuelve en
// .body) -- si tu versi?n lo envuelve distinto, ajustar esta l?nea.
const update = $json;

try {
  if (update.callback_query) {
    return await handleCallbackQuery(update.callback_query);
  }
  if (update.message && update.message.text) {
    return await handleTextMessage(update.message);
  }
  // Otro tipo de update de Telegram (foto, sticker, etc.) -- se ignora.
  return [{ json: { skip: true, reason: 'irrelevant_update' } }];
} catch (err) {
  // "Supabase ca?do" u otro fallo inesperado -- no se deja crasheado sin
  // explicaci?n; cada update de Telegram es una ejecuci?n independiente
  // de n8n, as? que esto no bloquea las siguientes interacciones.
  return [{ json: { skip: true, reason: 'internal_error', error: String(err) } }];
}
