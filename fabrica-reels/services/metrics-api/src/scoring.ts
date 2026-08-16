/**
 * Corazón de Capa 8: convierte un snapshot de métricas + el benchmark de
 * la cuenta en un score 0-100 y una clasificación. Puro, sin llamadas a
 * red ni a Supabase -- fácil de probar con números fijos (ver
 * capa7-8-metrics-scoring.md sección 3 para ejemplos reales).
 */

export type Classification = "malo" | "normal" | "prometedor" | "ganador" | "super_ganador";
export type BenchmarkConfidence = "account" | "fallback_generic";

export interface BenchmarkValues {
  avg_views: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  avg_shares: number | null;
  avg_saves: number | null;
  avg_follows: number | null;
  avg_engagement_rate: number | null;
  avg_retention_rate: number | null;
  sample_count: number;
}

export interface ScoreInput {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follows: number | null;
  retention_rate: number | null;
  benchmark: BenchmarkValues;
  min_samples_required: number;
}

export interface ScoreComponent {
  metric: string;
  weight: number; // peso YA redistribuido (ver nota abajo)
  base_weight: number; // peso original, antes de redistribuir
  index: number; // 0-1, métrica propia / (benchmark * 2), capado en 1
  contribution: number; // weight * index
  available: boolean;
}

export interface ScoreResult {
  score: number;
  classification: Classification;
  benchmark_confidence: BenchmarkConfidence;
  components: ScoreComponent[];
  retention_penalty: number;
  viral_bonus: number;
}

// Benchmark genérico de arranque para cuentas sin historial suficiente
// (sample_count < min_samples_required). Son números de referencia
// razonables para una cuenta chica/nueva, NO una medición real -- están
// para que el score no se dispare o se hunda de forma absurda cuando
// todavía no hay datos propios confiables. Ajustar si la realidad de tu
// nicho es muy distinta.
const FALLBACK_BENCHMARK: BenchmarkValues = {
  avg_views: 500,
  avg_likes: 25,
  avg_comments: 3,
  avg_shares: 5,
  avg_saves: 8,
  avg_follows: 1,
  avg_engagement_rate: 0.05,
  avg_retention_rate: 0.3,
  sample_count: 0,
};

// Suman 100. "engagement" es (likes+comments+shares+saves)/views contra
// el engagement_rate promedio de la cuenta -- captura la forma general
// del posteo además de cada métrica individual.
const BASE_WEIGHTS: Record<string, number> = {
  views: 25,
  shares: 20,
  saves: 20,
  comments: 10,
  follows: 10,
  engagement: 10,
  retention: 5,
};

const RETENTION_FLOOR = 0.15; // por debajo de esto, penalización dura sin importar el benchmark
const RETENTION_PENALTY = 10;
const VIRAL_BONUS = 10;

function indexOf(value: number | null, benchmarkValue: number | null): { index: number; available: boolean } {
  if (value === null || benchmarkValue === null || benchmarkValue <= 0) {
    return { index: 0, available: false };
  }
  return { index: Math.min(value / benchmarkValue / 2, 1), available: true };
}

export function calculatePerformanceScore(input: ScoreInput): ScoreResult {
  const useFallback = input.benchmark.sample_count < input.min_samples_required;
  const bm = useFallback ? FALLBACK_BENCHMARK : input.benchmark;

  const engagementRate =
    input.views && input.views > 0
      ? ((input.likes || 0) + (input.comments || 0) + (input.shares || 0) + (input.saves || 0)) / input.views
      : null;

  const raw = [
    { metric: "views", weight: BASE_WEIGHTS.views, ...indexOf(input.views, bm.avg_views) },
    { metric: "shares", weight: BASE_WEIGHTS.shares, ...indexOf(input.shares, bm.avg_shares) },
    { metric: "saves", weight: BASE_WEIGHTS.saves, ...indexOf(input.saves, bm.avg_saves) },
    { metric: "comments", weight: BASE_WEIGHTS.comments, ...indexOf(input.comments, bm.avg_comments) },
    { metric: "follows", weight: BASE_WEIGHTS.follows, ...indexOf(input.follows, bm.avg_follows) },
    { metric: "engagement", weight: BASE_WEIGHTS.engagement, ...indexOf(engagementRate, bm.avg_engagement_rate) },
    { metric: "retention", weight: BASE_WEIGHTS.retention, ...indexOf(input.retention_rate, bm.avg_retention_rate) },
  ];

  // Redistribución generalizada: el peso de cualquier métrica no
  // disponible (ej. saves/retención en TikTok) se reparte proporcionalmente
  // entre las que SÍ están disponibles, en vez de simplemente perderse.
  const availableWeight = raw.filter((c) => c.available).reduce((acc, c) => acc + c.weight, 0);
  const unavailableWeight = raw.filter((c) => !c.available).reduce((acc, c) => acc + c.weight, 0);

  const components: ScoreComponent[] = raw.map((c) => {
    if (!c.available) {
      return { metric: c.metric, weight: 0, base_weight: c.weight, index: 0, contribution: 0, available: false };
    }
    const redistributedWeight = availableWeight > 0 ? c.weight + unavailableWeight * (c.weight / availableWeight) : c.weight;
    return {
      metric: c.metric,
      weight: redistributedWeight,
      base_weight: c.weight,
      index: c.index,
      contribution: redistributedWeight * c.index,
      available: true,
    };
  });

  let score = components.reduce((acc, c) => acc + c.contribution, 0);

  // Penalización dura de retención: un 8% de retención es malo aunque el
  // promedio histórico de la cuenta también sea bajo -- por eso este
  // chequeo es contra un piso ABSOLUTO, no relativo al benchmark como el
  // resto de los índices.
  let retentionPenalty = 0;
  if (input.retention_rate !== null && input.retention_rate < RETENTION_FLOOR) {
    retentionPenalty = RETENTION_PENALTY;
    score -= retentionPenalty;
  }

  // Bonus viral: si shares, saves Y follows están todos al tope del índice
  // (2x+ el benchmark) al mismo tiempo, es una señal de que el video se
  // está compartiendo de verdad, no solo viéndose -- vale un empujón extra.
  const maxedSignals = ["shares", "saves", "follows"].filter((m) => {
    const c = components.find((x) => x.metric === m);
    return c && c.available && c.index >= 1;
  }).length;
  let viralBonus = 0;
  if (maxedSignals >= 2) {
    viralBonus = VIRAL_BONUS;
    score += viralBonus;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    classification: classify(score),
    benchmark_confidence: useFallback ? "fallback_generic" : "account",
    components,
    retention_penalty: retentionPenalty,
    viral_bonus: viralBonus,
  };
}

export function classify(score: number): Classification {
  if (score >= 85) return "super_ganador";
  if (score >= 70) return "ganador";
  if (score >= 60) return "prometedor";
  if (score >= 40) return "normal";
  return "malo";
}

/**
 * Score consolidado cuando el mismo raw_video se publicó en más de una
 * plataforma: promedio ponderado por views (más views = más peso en el
 * consolidado). Si no hay views en ninguna, cae a promedio simple.
 */
export function consolidateScores(perPlatform: { score: number; views: number | null }[]): { score: number; classification: Classification } {
  const totalViews = perPlatform.reduce((acc, p) => acc + (p.views || 0), 0);
  const score =
    totalViews > 0
      ? Math.round(perPlatform.reduce((acc, p) => acc + p.score * (p.views || 0), 0) / totalViews)
      : Math.round(perPlatform.reduce((acc, p) => acc + p.score, 0) / perPlatform.length);

  return { score, classification: classify(score) };
}
