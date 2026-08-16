/**
 * Nodo n8n: "7. Guardar edit_spec en Supabase"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 * Solo se ejecuta en la rama "válido" del IF.
 *
 * Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const SUPABASE_URL = $env.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: $env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

const inserted = await this.helpers.httpRequest({
  method: 'POST',
  url: `${SUPABASE_URL}/rest/v1/edit_specs`,
  headers: SUPABASE_HEADERS,
  body: {
    raw_video_id: $json.raw_video.id,
    template_id: $json.validation.data.template_id,
    spec_json: $json.validation.data,
    schema_version: $json.validation.data.schema_version,
    version: 1,
    status: 'ready',
    validation_status: 'valid',
    repair_attempts: $json.attempt - 1,
  },
  json: true,
});

return [{ json: { ...$json, edit_spec_id: inserted[0].id } }];
