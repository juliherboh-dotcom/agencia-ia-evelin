const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "Marcar failed_edit_spec_generation (agotados los intentos)"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * Se ejecuta cuando se agotaron los 3 intentos y el edit_spec sigue
 * inv?lido. Guarda el ?ltimo intento fallido para auditor?a (nunca se
 * borran los intentos fallidos, ver sistema-fabrica-reels-nexoia.md) y
 * deja el video en un estado que un humano tiene que revisar a mano.
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

await this.helpers.httpRequest({
  method: 'PATCH',
  url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${$json.raw_video.id}`,
  headers: SUPABASE_HEADERS,
  body: { status: 'failed_edit_spec_generation' },
  json: true,
});

await this.helpers.httpRequest({
  method: 'POST',
  url: `${SUPABASE_URL}/rest/v1/edit_specs`,
  headers: SUPABASE_HEADERS,
  body: {
    raw_video_id: $json.raw_video.id,
    template_id: 'personal_brand_clean',
    spec_json: $json.edit_spec_candidate,
    version: 1,
    status: 'draft',
    validation_status: 'invalid',
    validation_errors: $json.validation.errors,
    repair_attempts: $json.attempt,
  },
  json: true,
});

return [{ json: $json }];
