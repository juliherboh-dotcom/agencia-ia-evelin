import type { MetricsProvider, MetricsSnapshotRequest, MetricsSnapshotResult } from "../types";
import { metricsError } from "../types";

/**
 * ⚠️ Upload-Post es un proveedor de PUBLICACIÓN, no de analítica -- su
 * soporte de métricas (si existe en tu plan) es limitado y puede no
 * cubrir todas las plataformas ni todos los campos que pedimos. Este
 * adapter es un intento best-effort: llama a un endpoint de analytics
 * hipotético y devuelve lo que pueda, marcando `confidence_level='low'`
 * cuando falten campos.
 *
 * VERIFICAR antes de depender de esto en producción. Si Upload-Post no
 * ofrece analítica real (lo más probable), la estrategia recomendada es:
 * 1) fallback manual (`POST /metrics/manual`, ver server.ts), o
 * 2) migrar a las APIs oficiales de cada plataforma para esto
 *    específicamente (Instagram Graph API `insights`, TikTok Display
 *    API) -- ver capa7-8-metrics-scoring.md sección 4 para el detalle de
 *    qué expone cada una de forma confiable.
 *
 * Env vars usadas: UPLOAD_POST_API_KEY, UPLOAD_POST_API_URL (default
 * https://api.upload-post.com/api).
 */

const API_URL = process.env.UPLOAD_POST_API_URL || "https://api.upload-post.com/api";
const API_KEY = process.env.UPLOAD_POST_API_KEY;

export const uploadPostMetricsProvider: MetricsProvider = {
  name: "upload_post",

  async fetchSnapshot(req: MetricsSnapshotRequest): Promise<MetricsSnapshotResult> {
    if (!API_KEY) {
      return metricsError("UPLOAD_POST_API_KEY no configurada", false);
    }

    let response: Response;
    try {
      response = await fetch(`${API_URL}/analytics/${encodeURIComponent(req.provider_post_id)}`, {
        headers: { Authorization: `Apikey ${API_KEY}` },
      });
    } catch (err) {
      return metricsError(`Error de red llamando a Upload-Post: ${String(err)}`, true);
    }

    if (response.status === 401 || response.status === 403) {
      return metricsError("Token de Upload-Post vencido o sin permisos -- requiere reconectar", false);
    }
    if (response.status === 404) {
      return metricsError("Upload-Post no tiene datos de analítica para este post (esperable si no lo soporta)", false);
    }
    if (response.status === 429) {
      return metricsError("Rate limit de Upload-Post", true);
    }
    if (!response.ok) {
      return metricsError(`Upload-Post devolvió HTTP ${response.status}`, response.status >= 500);
    }

    const body = (await response.json().catch(() => null)) as Record<string, number | null> | null;
    if (!body) {
      return metricsError("Respuesta de Upload-Post no es JSON válido", true);
    }

    // Cuenta cuántos campos realmente vinieron con dato para decidir la
    // confianza del snapshot -- si viene todo vacío, mejor que quien mira
    // el dato sepa que es poco confiable en vez de asumir "0 real".
    const fields = [body.views, body.likes, body.comments, body.shares, body.saves];
    const presentCount = fields.filter((v) => v !== null && v !== undefined).length;

    return {
      ok: true,
      source: "api",
      confidence_level: presentCount >= 4 ? "medium" : "low",
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
  },
};
