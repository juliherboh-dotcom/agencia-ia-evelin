const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "2-3. Traer contexto + armar prompt Edit Director"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * Input: un item de raw_videos (status='assets_ready'), proveniente del
 * loop "Procesar de a uno".
 *
 * Hace las 4 lecturas de Supabase relacionadas al video (transcript,
 * analysis, assets, brand_kit) + trae el system prompt ya armado desde
 * edit-spec-api, y arma el user prompt espec?fico de este video.
 *
 * Campos de 0. Config: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EDIT_SPEC_API_URL
 */
const rawVideo = $json;

const SUPABASE_URL = cfg.SUPABASE_URL;
const EDIT_SPEC_API_URL = cfg.EDIT_SPEC_API_URL;
const SUPABASE_HEADERS = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
};

async function getOne(query) {
  const rows = await this.helpers.httpRequest({
    method: 'GET',
    url: `${SUPABASE_URL}/rest/v1/${query}`,
    headers: SUPABASE_HEADERS,
    json: true,
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

const [transcript, analysis, assets, brandKit, promptRes] = await Promise.all([
  getOne(`transcripts?raw_video_id=eq.${rawVideo.id}&select=text_full,words,language`),
  getOne(`analyses?raw_video_id=eq.${rawVideo.id}&select=tema,categoria,hook_principal,hook_score,score_calidad,descripcion_objetivo`),
  getOne(`assets?raw_video_id=eq.${rawVideo.id}&select=titulos,captions_ig,captions_tiktok,hashtags,hooks_alternativos,recomendacion_edicion`),
  getOne(`brand_kit?client_id=eq.${rawVideo.client_id}&select=logo_url,primary_color,accent_color,handle_instagram,handle_tiktok,end_card_cta`),
  this.helpers.httpRequest({
    method: 'GET',
    url: `${EDIT_SPEC_API_URL}/prompts/edit-director-system`,
    json: true,
  }),
]);

if (!transcript || !transcript.words || transcript.words.length === 0) {
  throw new Error(`raw_video ${rawVideo.id} no tiene transcripci?n con timestamps por palabra todav?a.`);
}
if (!analysis || !assets || !brandKit) {
  throw new Error(`raw_video ${rawVideo.id} est? marcado assets_ready pero falta analysis/assets/brand_kit en Supabase.`);
}

// Heur?stica de duraci?n objetivo: ~85% del bruto, acotada a [15,60]s.
// Punto de partida razonable -- el Edit Director puede ajustar los cortes
// para acercarse, no tiene que calzar exacto.
const targetSec = Math.min(60, Math.max(15, Math.round(rawVideo.duration_sec * 0.85)));

const today = new Date().toISOString().slice(0, 10);
// Sufijo num?rico de 3 d?gitos derivado del uuid, para no depender de un
// contador aparte -- suficiente para no colisionar dentro del mismo d?a.
const idDigits = String(parseInt(rawVideo.id.replace(/-/g, '').slice(0, 6), 16) % 1000).padStart(3, '0');
const videoId = `VID-${today}-${idDigits}`;

// MVP de este flujo: siempre instagram_reels. Multi-plataforma se resuelve
// generando un edit_spec por plataforma cuando se conecte la Capa 6.
const platform = 'instagram_reels';

const sourceVideoUrl = `${SUPABASE_URL}/storage/v1/object/public/raw/${rawVideo.client_id}/${rawVideo.storage_path}`;

const wordsFormatted = transcript.words
  .map((w) => `[${w.start.toFixed(2)}-${w.end.toFixed(2)}] ${w.word}`)
  .join(' ');

const userPrompt = [
  '## Datos fijos (copiar tal cual en el JSON de salida)',
  `video_id: ${videoId}`,
  `client_id: ${rawVideo.client_id}`,
  `raw_video_id: ${rawVideo.id}`,
  `platform: ${platform}`,
  `source_video.url: ${sourceVideoUrl}`,
  `source_video.duration_sec: ${rawVideo.duration_sec}`,
  `duration.target_sec: ${targetSec}`,
  `branding.logo_url: ${brandKit.logo_url}`,
  `branding.primary_color: ${brandKit.primary_color}`,
  `branding.accent_color: ${brandKit.accent_color}`,
  `branding.handle: ${brandKit.handle_instagram}`,
  'meta.created_by: llm_edit_director',
  `meta.created_at: ${new Date().toISOString()}`,
  'meta.version: 1',
  '',
  '## An?lisis previo',
  `tema: ${analysis.tema}`,
  `categoria: ${analysis.categoria}`,
  `hook_principal detectado: ${analysis.hook_principal}`,
  `hook_score previo: ${analysis.hook_score}/10`,
  `score_calidad previo: ${analysis.score_calidad}/10`,
  '',
  '## Hooks alternativos ya generados (pod?s usarlos o reescribir el propio)',
  JSON.stringify(assets.hooks_alternativos || []),
  '',
  '## Transcripci?n completa con timestamps por palabra (l?nea de tiempo del video FUENTE)',
  wordsFormatted,
].join('\n');

return [{
  json: {
    raw_video: rawVideo,
    video_id: videoId,
    platform,
    target_sec: targetSec,
    source_video_url: sourceVideoUrl,
    attempt: 1,
    system_prompt: promptRes.text,
    user_prompt: userPrompt,
  },
}];
