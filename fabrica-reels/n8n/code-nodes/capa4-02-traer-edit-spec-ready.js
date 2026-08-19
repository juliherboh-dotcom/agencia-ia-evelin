const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "2. Traer edit_spec listo para renderizar"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * Campos de 0. Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const rawVideo = $json;

const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
};

const rows = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/edit_specs?raw_video_id=eq.${rawVideo.id}&status=eq.ready&order=version.desc&limit=1&select=id,spec_json`,
  headers: SUPABASE_HEADERS,
  json: true,
});

const editSpec = rows[0];
if (!editSpec) {
  throw new Error(`raw_video ${rawVideo.id} est? en edit_spec_ready pero no se encontr? un edit_specs.status='ready' -- revisar Capa 3.`);
}

return [{
  json: {
    raw_video: rawVideo,
    edit_spec_id: editSpec.id,
    spec_json: editSpec.spec_json,
  },
}];
