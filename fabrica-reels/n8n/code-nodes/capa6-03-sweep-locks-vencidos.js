/**
 * Nodo n8n: "3. Sweep locks vencidos"
 * Tipo: Code (JavaScript, "Run Once for All Items")
 *
 * Si una ejecución de "2. Publicar (con lock)" muere a mitad de camino
 * (n8n se reinicia, timeout, etc.), la fila queda con locked_at seteado
 * para siempre y nunca se vuelve a intentar. Esto libera locks de más de
 * 10 minutos -- mismo principio que los sweeps de Capa 4 y Capa 5.
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

const TIMEOUT_MINUTES = 10;
const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000).toISOString();

const stuck = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/publications?locked_at=lt.${encodeURIComponent(cutoff)}&select=id,locked_by`,
  headers: SUPABASE_HEADERS,
  json: true,
});

const results = [];

for (const pub of stuck) {
  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/publications?id=eq.${pub.id}`,
    headers: SUPABASE_HEADERS,
    body: { locked_at: null, locked_by: null, updated_at: new Date().toISOString() },
    json: true,
  });
  results.push({ publication_id: pub.id, previously_locked_by: pub.locked_by });
}

return results.map((r) => ({ json: r }));
