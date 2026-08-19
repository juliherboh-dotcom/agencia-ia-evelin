const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "1. Reclamar ganador y preparar contexto"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 * Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EDIT_SPEC_API_URL
 */
const rawVideo = $json;
const SUPABASE_URL = cfg.SUPABASE_URL;
const headers = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

async function getRows(query) {
  return this.helpers.httpRequest({
    method: 'GET', url: `${SUPABASE_URL}/rest/v1/${query}`, headers, json: true,
  });
}

// Claim atomico: si otro poll ya lo tomo, PostgREST devuelve [] y este item
// termina sin generar ni persistir nada duplicado.
const claimed = await this.helpers.httpRequest({
  method: 'PATCH',
  url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${rawVideo.id}&variant_generation_status=eq.ready`,
  headers,
  body: {
    variant_generation_status: 'in_progress',
    variant_generation_started_at: new Date().toISOString(),
    variant_generation_error: null,
    variant_generation_attempts: (rawVideo.variant_generation_attempts || 0) + 1,
  },
  json: true,
});
if (!claimed.length) return [];

const [transcripts, analyses, assetRows, brandRows, scoreRows, editSpecRows, renderRows, promptRes] = await Promise.all([
  getRows.call(this, `transcripts?raw_video_id=eq.${rawVideo.id}&select=text_full,words,language&order=created_at.desc&limit=1`),
  getRows.call(this, `analyses?raw_video_id=eq.${rawVideo.id}&select=tema,categoria,hook_principal,hook_score,score_calidad,descripcion_objetivo,raw_llm_response&order=created_at.desc&limit=1`),
  getRows.call(this, `assets?raw_video_id=eq.${rawVideo.id}&select=titulos,captions_ig,captions_tiktok,hashtags,hooks_alternativos,recomendacion_edicion`),
  getRows.call(this, `brand_kit?client_id=eq.${rawVideo.client_id}&select=logo_url,primary_color,accent_color,handle_instagram,handle_tiktok,end_card_cta&limit=1`),
  getRows.call(this, `scores?raw_video_id=eq.${rawVideo.id}&select=id,score_rendimiento,classification,platform,window,components,computed_at&order=score_rendimiento.desc,computed_at.desc&limit=1`),
  getRows.call(this, `edit_specs?raw_video_id=eq.${rawVideo.id}&validation_status=eq.valid&select=id,spec_json,version&order=version.desc&limit=1`),
  getRows.call(this, `renders?raw_video_id=eq.${rawVideo.id}&select=id&order=created_at.desc`),
  this.helpers.httpRequest({ method: 'GET', url: `${cfg.EDIT_SPEC_API_URL}/prompts/variant-director-system`, json: true }),
]);

const transcript = transcripts[0];
const analysis = analyses[0];
const assets = assetRows[0];
const brandKit = brandRows[0];
const winningScore = scoreRows[0];
const parentEditSpec = editSpecRows[0];
if (!transcript?.words?.length || !analysis || !assets || !brandKit || !winningScore || !parentEditSpec) {
  throw new Error(`Contexto incompleto para Capa 9 en raw_video ${rawVideo.id}: se requieren transcript.words, analysis, assets, brand_kit, score y edit_spec valido.`);
}

let manualRequest = null;
if (rawVideo.status === 'variant_requested' && renderRows.length) {
  const ids = renderRows.map((r) => r.id).join(',');
  const actions = await getRows.call(this, `review_actions?render_id=in.(${ids})&decision=eq.variant_requested&select=variant_type,comment,decided_at&order=decided_at.desc&limit=1`);
  manualRequest = actions[0] || null;
}

const sourceVideoUrl = parentEditSpec.spec_json?.source_video?.url ||
  `${SUPABASE_URL}/storage/v1/object/public/raw/${rawVideo.client_id}/${rawVideo.storage_path}`;
const baseSpec = parentEditSpec.spec_json;
const today = new Date().toISOString().slice(0, 10);
const seed = parseInt(rawVideo.id.replace(/-/g, '').slice(0, 8), 16) % 100000;
const variantIds = [0, 1, 2].map((n) => `VID-${today}-${String(seed + n).padStart(5, '0')}`);

const userPrompt = [
  '## Ganador y evidencia',
  JSON.stringify({
    raw_video: { ...rawVideo, source_video_url: sourceVideoUrl },
    best_score: rawVideo.best_score,
    performance_classification: rawVideo.performance_classification,
    winning_score: winningScore,
    analysis,
    assets,
    manual_request: manualRequest,
  }),
  '',
  '## Transcripcion completa',
  JSON.stringify({ text_full: transcript.text_full, words: transcript.words, language: transcript.language }),
  '',
  '## Edit spec ganador de referencia',
  JSON.stringify(baseSpec),
  '',
  '## Datos fijos para las variantes Tipo B',
  JSON.stringify({
    video_ids_en_orden: variantIds,
    client_id: rawVideo.client_id,
    raw_video_id: rawVideo.id,
    source_video: { url: sourceVideoUrl, duration_sec: rawVideo.duration_sec },
    platform: baseSpec.platform,
    branding: baseSpec.branding,
    meta_version: parentEditSpec.version + 1,
  }),
].join('\n');

return [{ json: {
  raw_video: rawVideo,
  parent_edit_spec_id: parentEditSpec.id,
  next_edit_spec_version: parentEditSpec.version + 1,
  manual_request: manualRequest,
  system_prompt: promptRes.text,
  user_prompt: userPrompt,
} }];
