/**
 * Contrato interno de Capa 7. Todo lo que hable con un proveedor de
 * métricas externo entra por `MetricsSnapshotRequest` y sale por
 * `MetricsSnapshotResult` -- n8n y Supabase nunca ven la forma específica
 * de un proveedor. Cambiar de proveedor (o agregar una API oficial
 * directa) es un archivo nuevo en `providers/`, no un cambio al workflow.
 */

export type Platform = "tiktok" | "instagram_reels";
export type MetricsWindow = "24h" | "48h" | "72h" | "7d";

export interface MetricsSnapshotRequest {
  publication_id: string;
  platform: Platform;
  provider: string; // "mock" | "upload_post" | "manual" | futuro: "meta_direct" | "tiktok_direct"
  provider_post_id: string;
  window: MetricsWindow;
}

export type ConfidenceLevel = "high" | "medium" | "low";
export type MetricsSource = "api" | "manual" | "estimated";

export interface MetricsSnapshotResult {
  ok: boolean;
  source: MetricsSource;
  confidence_level: ConfidenceLevel;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follows: number | null;
  profile_visits: number | null;
  avg_watch_time_sec: number | null;
  retention_rate: number | null; // 0-1
  completion_rate: number | null; // 0-1
  raw_payload: unknown;
  error_message: string | null;
  retryable: boolean;
}

export interface MetricsProvider {
  name: string;
  fetchSnapshot(req: MetricsSnapshotRequest): Promise<MetricsSnapshotResult>;
}

export function metricsError(message: string, retryable: boolean): MetricsSnapshotResult {
  return {
    ok: false,
    source: "api",
    confidence_level: "low",
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    follows: null,
    profile_visits: null,
    avg_watch_time_sec: null,
    retention_rate: null,
    completion_rate: null,
    raw_payload: null,
    error_message: message,
    retryable,
  };
}
