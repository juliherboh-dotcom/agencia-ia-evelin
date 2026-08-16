/**
 * Nodo n8n: "6. Procesar decisión de revisión"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 * Disparado por el Telegram Trigger, escuchando actualizaciones tipo
 * callback_query (los clicks en los botones del mensaje de revisión).
 *
 * callback_data llega en el formato "<accion>:<id>":
 *   appr = aprobar          (id = render_id)
 *   rejt = rechazar         (id = render_id)
 *   varr = pedir variante   (id = render_id)
 *   retr = reintentar render (id = raw_video_id)
 *
 * Esto es la versión mínima de Capa 5 (revisión humana) -- deja escrito
 * en review_actions y raw_videos.status lo necesario para que la Capa 5
 * "de verdad" (portal propio, ver sistema-fabrica-reels-nexoia.md sección
 * 14) se enchufe después sin cambiar el modelo de datos.
 *
 * Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const update = $json;
const callbackQuery = update.callback_query;

if (!callbackQuery) {
  // Update de Telegram que no es un click de botón (ej. un mensaje de
  // texto normal al bot) -- no hacemos nada con esto en este flujo.
  return [{ json: { skip: true } }];
}

const [action, targetId] = (callbackQuery.data || '').split(':');
const reviewer = callbackQuery.from && callbackQuery.from.username
  ? `telegram:@${callbackQuery.from.username}`
  : `telegram:${callbackQuery.from ? callbackQuery.from.id : 'desconocido'}`;

const SUPABASE_URL = $env.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: $env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

const getRender = async (renderId) => {
  const rows = await this.helpers.httpRequest({
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/renders?id=eq.${renderId}&select=id,raw_video_id`,
    headers: SUPABASE_HEADERS,
    json: true,
  });
  return rows[0];
};

let confirmationText = '';
let toastText = '';

if (action === 'appr' || action === 'rejt' || action === 'varr') {
  const render = await getRender(targetId);
  if (!render) {
    return [{ json: { skip: true, error: `render ${targetId} no encontrado` } }];
  }

  const decisionMap = { appr: 'approved', rejt: 'rejected', varr: 'variant_requested' };
  const decision = decisionMap[action];

  await this.helpers.httpRequest({
    method: 'POST',
    url: `${SUPABASE_URL}/rest/v1/review_actions`,
    headers: SUPABASE_HEADERS,
    body: { render_id: targetId, reviewer, decision, decided_at: new Date().toISOString() },
    json: true,
  });

  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${render.raw_video_id}`,
    headers: SUPABASE_HEADERS,
    body: { status: decision },
    json: true,
  });

  const labelMap = { appr: '✅ Aprobado', rejt: '❌ Rechazado', varr: '🔁 Variante solicitada' };
  confirmationText = `${labelMap[action]} por ${reviewer}`;
  toastText = labelMap[action];
} else if (action === 'retr') {
  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${targetId}`,
    headers: SUPABASE_HEADERS,
    body: { status: 'edit_spec_ready', render_attempts: 0 },
    json: true,
  });
  confirmationText = `🔁 Reintento encolado por ${reviewer} -- se vuelve a disparar en el próximo ciclo (cada 2 min).`;
  toastText = 'Reintento encolado';
} else {
  return [{ json: { skip: true, error: `acción desconocida: ${action}` } }];
}

return [{
  json: {
    skip: false,
    callback_query_id: callbackQuery.id,
    chat_id: callbackQuery.message && callbackQuery.message.chat ? callbackQuery.message.chat.id : null,
    message_id: callbackQuery.message ? callbackQuery.message.message_id : null,
    confirmation_text: confirmationText,
    toast_text: toastText,
  },
}];
