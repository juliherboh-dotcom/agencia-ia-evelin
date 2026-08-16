/**
 * Nodo n8n: "1. Detectar publicaciones listas para publicar"
 * Tipo: Code (JavaScript, "Run Once for All Items")
 *
 * publications en 'ready_to_schedule', cuyo scheduled_at ya llegó, sin
 * lock activo, y (si es un reintento) cuyo next_attempt_at ya pasó.
 * Se arma la URL a mano en vez de usar la UI de query params de un nodo
 * HTTP nativo porque el filtro `or=()` de PostgREST (next_attempt_at
 * NULL o ya vencido) es más simple de construir con template strings que
 * peleando con esa UI.
 *
 * Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const SUPABASE_URL = $env.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: $env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`,
};

const nowIso = new Date().toISOString();

const query = [
  'status=eq.ready_to_schedule',
  `scheduled_at=lte.${encodeURIComponent(nowIso)}`,
  'locked_at=is.null',
  `or=(${encodeURIComponent(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)})`,
  'select=id,client_id,platform,render_id,raw_video_id,account_id,provider,caption_used,retry_count',
  'order=scheduled_at.asc',
].join('&');

const rows = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/publications?${query}`,
  headers: SUPABASE_HEADERS,
  json: true,
});

return rows.map((r) => ({ json: r }));
