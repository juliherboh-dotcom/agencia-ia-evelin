const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "0. Detectar ganadores listos"
 * Tipo: Code (JavaScript, "Run Once for All Items")
 * Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const SUPABASE_URL = cfg.SUPABASE_URL;
const headers = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
};

const videos = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/raw_videos?variant_generation_status=eq.ready&select=id,client_id,filename,storage_path,duration_sec,status,best_score,performance_classification,variant_generation_attempts,uploaded_at&order=uploaded_at.asc`,
  headers,
  json: true,
});

return videos.map((video) => ({ json: video }));
