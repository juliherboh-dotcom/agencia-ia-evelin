const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "1. Sweep sesiones de comentario vencidas"
 * Tipo: Code (JavaScript, "Run Once for All Items")
 *
 * Si un revisor clickea "Rechazar" / "Pedir cambios" / "Marcar como
 * error" / elige un tipo de variante y despu?s nunca escribe el
 * comentario ("comentario pendiente que nunca llega"), la sesi?n queda
 * "awaiting_comment" o "awaiting_variant_type" para siempre si nadie la
 * cierra. Esto la cierra sola a los 30 minutos, finalizando la decisi?n
 * con un comentario placeholder en vez de dejar el video colgado --
 * mismo principio que el sweep de renders vencidos de Capa 4.
 *
 * Campos de 0. Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

const finalStatusMap = {
  reject: 'rejected',
  variant_requested: 'variant_requested',
  needs_changes: 'needs_changes',
  error_flagged: 'error_flagged',
};

const expired = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/review_sessions?status=in.(awaiting_comment,awaiting_variant_type)&expires_at=lt.${encodeURIComponent(new Date().toISOString())}&select=id,render_id,raw_video_id,pending_action,variant_type,reviewer_telegram_user_id`,
  headers: SUPABASE_HEADERS,
  json: true,
});

const results = [];

for (const session of expired) {
  const decision = finalStatusMap[session.pending_action] || session.pending_action;

  await this.helpers.httpRequest({
    method: 'POST',
    url: `${SUPABASE_URL}/rest/v1/review_actions`,
    headers: SUPABASE_HEADERS,
    body: {
      render_id: session.render_id,
      reviewer: session.reviewer_telegram_user_id ? `telegram:${session.reviewer_telegram_user_id}` : 'telegram:desconocido',
      decision,
      variant_type: session.variant_type || null,
      comment: '(sin comentario -- expir? la espera de 30 minutos)',
      session_id: session.id,
      decided_at: new Date().toISOString(),
    },
    json: true,
  });

  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${session.raw_video_id}`,
    headers: SUPABASE_HEADERS,
    body: { status: decision },
    json: true,
  });

  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/review_sessions?id=eq.${session.id}`,
    headers: SUPABASE_HEADERS,
    body: { status: 'expired', updated_at: new Date().toISOString() },
    json: true,
  });

  results.push({ session_id: session.id, raw_video_id: session.raw_video_id, decision });
}

return results.map((r) => ({ json: r }));
