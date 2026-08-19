const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "0. Sweep renders vencidos (timeout)"
 * Tipo: Code (JavaScript, "Run Once for All Items")
 *
 * Red de seguridad del patr?n async: si renderService se cae a mitad de
 * un render (o nunca llega a llamar al webhook de resultado por lo que
 * sea), esto evita que el video quede "colgado" en rendering para
 * siempre. Corre en cada ciclo del Schedule Trigger, en paralelo a la
 * rama que dispara renders nuevos.
 *
 * Campos de 0. Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

const TIMEOUT_MINUTES = 10;
const MAX_RENDER_ATTEMPTS = 3;
const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000).toISOString();

const stuck = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/renders?status=in.(queued,rendering)&created_at=lt.${encodeURIComponent(cutoff)}&select=id,raw_video_id,attempt,created_at`,
  headers: SUPABASE_HEADERS,
  json: true,
});

const results = [];

for (const render of stuck) {
  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/renders?id=eq.${render.id}`,
    headers: SUPABASE_HEADERS,
    body: {
      status: 'failed',
      error_message: `Timeout: sin respuesta de render service despu?s de ${TIMEOUT_MINUTES} minutos`,
      stage: 'render',
      updated_at: new Date().toISOString(),
    },
    json: true,
  });

  const nextStatus = render.attempt < MAX_RENDER_ATTEMPTS ? 'edit_spec_ready' : 'failed_render_timeout';

  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${render.raw_video_id}`,
    headers: SUPABASE_HEADERS,
    body: { status: nextStatus },
    json: true,
  });

  results.push({ render_id: render.id, raw_video_id: render.raw_video_id, next_status: nextStatus });
}

return results.map((r) => ({ json: r }));
