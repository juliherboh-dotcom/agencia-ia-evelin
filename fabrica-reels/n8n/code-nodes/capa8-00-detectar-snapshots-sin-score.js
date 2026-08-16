/**
 * Nodo n8n: "0. Detectar snapshots sin score"
 * Tipo: Code (JavaScript, "Run Once for All Items")
 *
 * post_metrics con source != 'failed' que todavía no tienen una fila en
 * `scores` asociada (metric_snapshot_id).
 *
 * Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const SUPABASE_URL = $env.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: $env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`,
};

const snapshots = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/post_metrics?source=neq.failed&select=id,publication_id,client_id,raw_video_id,platform,snapshot_window,views,likes,comments,shares,saves,follows,retention_rate`,
  headers: SUPABASE_HEADERS,
  json: true,
});

const results = [];
for (const snap of snapshots) {
  const scored = await this.helpers.httpRequest({
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/scores?metric_snapshot_id=eq.${snap.id}&select=id`,
    headers: SUPABASE_HEADERS,
    json: true,
  });
  if (scored.length === 0) results.push(snap);
}

return results.map((r) => ({ json: r }));
