/**
 * Nodo n8n: "1. Calcular y guardar score"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * 1) Recalcula el benchmark de cuenta+plataforma+ventana (rolling últimas
 *    50 muestras, excluyendo la propia publicación para no sesgarlo).
 * 2) Pide el score a metrics-api.
 * 3) Guarda la fila en `scores`.
 * 4) Si el video cruza el umbral de ganador por primera vez, actualiza
 *    raw_videos y deja `variant_generation_status='ready'` para Capa 9.
 * 5) Si el mismo raw_video tiene score en más de una plataforma para
 *    esta ventana, calcula también el score consolidado.
 *
 * Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * METRICS_API_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */
const SUPABASE_URL = $env.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: $env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};
const METRICS_API_URL = $env.METRICS_API_URL;

const snap = $json;
const MIN_SAMPLES_REQUIRED = 5;
const ROLLING_SAMPLE_SIZE = 50;
const WINNER_THRESHOLD = 70;

// 1. Recalcular benchmark.
const history = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/post_metrics?client_id=eq.${snap.client_id}&platform=eq.${snap.platform}&snapshot_window=eq.${snap.snapshot_window}&publication_id=neq.${snap.publication_id}&source=neq.failed&order=snapshot_at.desc&limit=${ROLLING_SAMPLE_SIZE}&select=views,likes,comments,shares,saves,follows,retention_rate`,
  headers: SUPABASE_HEADERS,
  json: true,
});

const avgOf = (key) => {
  const vals = history.map((h) => h[key]).filter((v) => v !== null && v !== undefined);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};
const engagementRates = history
  .filter((h) => h.views)
  .map((h) => ((h.likes || 0) + (h.comments || 0) + (h.shares || 0) + (h.saves || 0)) / h.views);
const avgEngagementRate = engagementRates.length ? engagementRates.reduce((a, b) => a + b, 0) / engagementRates.length : null;

const benchmark = {
  avg_views: avgOf('views'),
  avg_likes: avgOf('likes'),
  avg_comments: avgOf('comments'),
  avg_shares: avgOf('shares'),
  avg_saves: avgOf('saves'),
  avg_follows: avgOf('follows'),
  avg_engagement_rate: avgEngagementRate,
  avg_retention_rate: avgOf('retention_rate'),
  sample_count: history.length,
};

await this.helpers.httpRequest({
  method: 'POST',
  url: `${SUPABASE_URL}/rest/v1/account_benchmarks?on_conflict=client_id,platform,window`,
  headers: { ...SUPABASE_HEADERS, Prefer: 'resolution=merge-duplicates,return=representation' },
  body: {
    client_id: snap.client_id,
    platform: snap.platform,
    window: snap.snapshot_window,
    ...benchmark,
    min_samples_required: MIN_SAMPLES_REQUIRED,
    updated_at: new Date().toISOString(),
  },
  json: true,
});

// 2. Pedir el score.
const scoreResult = await this.helpers.httpRequest({
  method: 'POST',
  url: `${METRICS_API_URL}/score`,
  body: {
    views: snap.views,
    likes: snap.likes,
    comments: snap.comments,
    shares: snap.shares,
    saves: snap.saves,
    follows: snap.follows,
    retention_rate: snap.retention_rate,
    benchmark,
    min_samples_required: MIN_SAMPLES_REQUIRED,
  },
  json: true,
});

// 3. Guardar la fila de score.
await this.helpers.httpRequest({
  method: 'POST',
  url: `${SUPABASE_URL}/rest/v1/scores`,
  headers: SUPABASE_HEADERS,
  body: {
    publication_id: snap.publication_id,
    raw_video_id: snap.raw_video_id,
    metric_snapshot_id: snap.id,
    platform: snap.platform,
    window: snap.snapshot_window,
    score_rendimiento: scoreResult.score,
    classification: scoreResult.classification,
    benchmark_confidence: scoreResult.benchmark_confidence,
    components: scoreResult.components,
    computed_at: new Date().toISOString(),
  },
  json: true,
});

// 4. Actualizar raw_video con el mejor score visto hasta ahora. Una vez
// ganador, se queda ganador -- una ventana posterior más floja no le
// saca el título (el "pico" es la señal que importa para variantes).
const rawVideos = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${snap.raw_video_id}&select=id,best_score,variant_generation_status,client_id`,
  headers: SUPABASE_HEADERS,
  json: true,
});
const rawVideo = rawVideos[0];

if (rawVideo) {
  const isNewBest = rawVideo.best_score === null || scoreResult.score > rawVideo.best_score;
  const updateBody = {};
  if (isNewBest) {
    updateBody.best_score = scoreResult.score;
    updateBody.performance_classification = scoreResult.classification;
  }

  const crossesWinnerNow =
    scoreResult.score >= WINNER_THRESHOLD &&
    (!rawVideo.variant_generation_status || rawVideo.variant_generation_status === 'not_applicable');
  if (crossesWinnerNow) {
    updateBody.variant_generation_status = 'ready';
  }

  if (Object.keys(updateBody).length > 0) {
    await this.helpers.httpRequest({
      method: 'PATCH',
      url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${snap.raw_video_id}`,
      headers: SUPABASE_HEADERS,
      body: updateBody,
      json: true,
    });
  }

  if (crossesWinnerNow) {
    const clients = await this.helpers.httpRequest({
      method: 'GET',
      url: `${SUPABASE_URL}/rest/v1/clients?id=eq.${rawVideo.client_id}&select=telegram_chat_id`,
      headers: SUPABASE_HEADERS,
      json: true,
    });
    const chatId = (clients[0] && clients[0].telegram_chat_id) || $env.TELEGRAM_CHAT_ID;
    const label = scoreResult.classification === 'super_ganador' ? '🏆 SUPER GANADOR' : '🎉 Ganador';
    await this.helpers.httpRequest({
      method: 'POST',
      url: `https://api.telegram.org/bot${$env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      body: {
        chat_id: chatId,
        text: `${label} detectado -- score ${scoreResult.score}/100 (${snap.snapshot_window}, ${snap.platform}). Listo para generar variantes en Capa 9.`,
      },
      json: true,
    });
  }
}

// 5. Score consolidado si hay más de una plataforma para este raw_video+ventana.
const platformScores = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/scores?raw_video_id=eq.${snap.raw_video_id}&window=eq.${snap.snapshot_window}&platform=neq.consolidated&select=platform,score_rendimiento,publication_id`,
  headers: SUPABASE_HEADERS,
  json: true,
});

if (platformScores.length >= 2) {
  const withViews = [];
  for (const p of platformScores) {
    const m = await this.helpers.httpRequest({
      method: 'GET',
      url: `${SUPABASE_URL}/rest/v1/post_metrics?publication_id=eq.${p.publication_id}&snapshot_window=eq.${snap.snapshot_window}&select=views`,
      headers: SUPABASE_HEADERS,
      json: true,
    });
    withViews.push({ score: p.score_rendimiento, views: m[0] ? m[0].views : null });
  }

  const consolidated = await this.helpers.httpRequest({
    method: 'POST',
    url: `${METRICS_API_URL}/consolidate`,
    body: { scores: withViews },
    json: true,
  });

  await this.helpers.httpRequest({
    method: 'POST',
    url: `${SUPABASE_URL}/rest/v1/scores?on_conflict=raw_video_id,window,platform`,
    headers: { ...SUPABASE_HEADERS, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: {
      raw_video_id: snap.raw_video_id,
      platform: 'consolidated',
      window: snap.snapshot_window,
      score_rendimiento: consolidated.score,
      classification: consolidated.classification,
      computed_at: new Date().toISOString(),
    },
    json: true,
  });
}

return [{ json: { ...snap, outcome: 'scored', score: scoreResult.score, classification: scoreResult.classification } }];
