/**
 * Nodo n8n: "0. Detectar snapshots pendientes"
 * Tipo: Code (JavaScript, "Run Once for All Items")
 *
 * Para cada publication en status='published', calcula qué ventanas
 * (24h/48h/72h/7d) ya deberían tener snapshot según published_at, y
 * devuelve un item por cada (publication, window) que todavía no tiene
 * fila en post_metrics.
 *
 * Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const SUPABASE_URL = $env.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: $env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`,
};

const WINDOW_HOURS = { '24h': 24, '48h': 48, '72h': 72, '7d': 168 };

const published = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/publications?status=eq.published&select=id,client_id,platform,render_id,raw_video_id,account_id,published_at`,
  headers: SUPABASE_HEADERS,
  json: true,
});

const now = Date.now();
const results = [];

for (const pub of published) {
  if (!pub.published_at) continue;
  const publishedAt = new Date(pub.published_at).getTime();

  const existing = await this.helpers.httpRequest({
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/post_metrics?publication_id=eq.${pub.id}&select=snapshot_window`,
    headers: SUPABASE_HEADERS,
    json: true,
  });
  const done = new Set(existing.map((e) => e.snapshot_window));

  for (const [windowName, hours] of Object.entries(WINDOW_HOURS)) {
    if (done.has(windowName)) continue;
    const dueAt = publishedAt + hours * 3600 * 1000;
    if (now >= dueAt) {
      results.push({
        publication_id: pub.id,
        client_id: pub.client_id,
        platform: pub.platform,
        render_id: pub.render_id,
        raw_video_id: pub.raw_video_id,
        account_id: pub.account_id,
        window: windowName,
      });
    }
  }
}

return results.map((r) => ({ json: r }));
