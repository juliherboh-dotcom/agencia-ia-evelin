const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "8. Actualizar estado -> edit_spec_ready"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * Campos de 0. Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

await this.helpers.httpRequest({
  method: 'PATCH',
  url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${$json.raw_video.id}`,
  headers: SUPABASE_HEADERS,
  body: { status: 'edit_spec_ready' },
  json: true,
});

return [{ json: $json }];
