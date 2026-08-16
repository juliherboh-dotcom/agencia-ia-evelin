/**
 * metrics-api -- servicio delgado de Capa 7-8.
 *
 * n8n orquesta (detecta qué ventanas necesitan snapshot, recalcula el
 * benchmark, decide cuándo marcar un video ganador) pero delega en ESTE
 * servicio: (1) hablar con el proveedor de métricas concreto, y (2) la
 * fórmula de scoring en sí (`calculatePerformanceScore`), para que viva
 * en un solo lugar, tipado y testeable, no duplicada dentro de un nodo
 * Code.
 */
import express from "express";
import { getMetricsProvider } from "./providerRegistry";
import { calculatePerformanceScore, consolidateScores, type BenchmarkValues } from "./scoring";
import type { MetricsSnapshotRequest, MetricsSnapshotResult } from "./types";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/snapshot", async (req, res) => {
  const job = req.body as Partial<MetricsSnapshotRequest>;

  const required: (keyof MetricsSnapshotRequest)[] = ["publication_id", "platform", "provider", "provider_post_id", "window"];
  const missing = required.filter((f) => !job[f]);
  if (missing.length > 0) {
    return res.status(200).json({
      ok: false, source: "api", confidence_level: "low",
      views: null, likes: null, comments: null, shares: null, saves: null,
      follows: null, profile_visits: null, avg_watch_time_sec: null,
      retention_rate: null, completion_rate: null, raw_payload: null,
      error_message: `Faltan campos obligatorios: ${missing.join(", ")}`,
      retryable: false,
    });
  }

  const provider = getMetricsProvider(job.provider as string);
  if (!provider) {
    return res.status(200).json({
      ok: false, source: "api", confidence_level: "low",
      views: null, likes: null, comments: null, shares: null, saves: null,
      follows: null, profile_visits: null, avg_watch_time_sec: null,
      retention_rate: null, completion_rate: null, raw_payload: null,
      error_message: `Proveedor de métricas desconocido: "${job.provider}"`,
      retryable: false,
    });
  }

  try {
    const result = await provider.fetchSnapshot(job as MetricsSnapshotRequest);
    return res.status(200).json(result);
  } catch (err) {
    const errorResult: MetricsSnapshotResult = {
      ok: false, source: "api", confidence_level: "low",
      views: null, likes: null, comments: null, shares: null, saves: null,
      follows: null, profile_visits: null, avg_watch_time_sec: null,
      retention_rate: null, completion_rate: null, raw_payload: null,
      error_message: `Error no controlado en el adapter: ${String(err)}`,
      retryable: true,
    };
    return res.status(200).json(errorResult);
  }
});

/**
 * Fallback manual: para cuando el proveedor no expone una métrica (ej.
 * guardados de TikTok) y alguien la carga a mano después de mirar
 * TikTok Studio. Mismo shape de respuesta que /snapshot, source='manual'
 * fijo. También es el endpoint que usa scripts/import-metrics-csv.ts.
 */
app.post("/metrics/manual", (req, res) => {
  const body = req.body as Partial<MetricsSnapshotResult>;
  const result: MetricsSnapshotResult = {
    ok: true,
    source: "manual",
    confidence_level: body.confidence_level || "medium",
    views: body.views ?? null,
    likes: body.likes ?? null,
    comments: body.comments ?? null,
    shares: body.shares ?? null,
    saves: body.saves ?? null,
    follows: body.follows ?? null,
    profile_visits: body.profile_visits ?? null,
    avg_watch_time_sec: body.avg_watch_time_sec ?? null,
    retention_rate: body.retention_rate ?? null,
    completion_rate: body.completion_rate ?? null,
    raw_payload: body,
    error_message: null,
    retryable: false,
  };
  res.json(result);
});

app.post("/score", (req, res) => {
  const body = req.body as {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    follows: number | null;
    retention_rate: number | null;
    benchmark: BenchmarkValues;
    min_samples_required: number;
  };

  const result = calculatePerformanceScore({
    views: body.views ?? null,
    likes: body.likes ?? null,
    comments: body.comments ?? null,
    shares: body.shares ?? null,
    saves: body.saves ?? null,
    follows: body.follows ?? null,
    retention_rate: body.retention_rate ?? null,
    benchmark: body.benchmark,
    min_samples_required: body.min_samples_required ?? 5,
  });

  res.json(result);
});

app.post("/consolidate", (req, res) => {
  const body = req.body as { scores: { score: number; views: number | null }[] };
  if (!body.scores || body.scores.length === 0) {
    return res.status(200).json({ error: "scores vacío" });
  }
  const result = consolidateScores(body.scores);
  res.json(result);
});

const PORT = process.env.METRICS_API_PORT ? Number(process.env.METRICS_API_PORT) : 3004;
app.listen(PORT, () => console.log(`metrics-api escuchando en :${PORT}`));
