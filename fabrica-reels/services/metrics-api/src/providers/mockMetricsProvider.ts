import type { MetricsProvider, MetricsSnapshotRequest, MetricsSnapshotResult } from "../types";

/**
 * Proveedor de prueba: no llama a nada externo. Genera números
 * determinísticos (mismo provider_post_id + window siempre dan el mismo
 * resultado, útil para tests reproducibles) que simulan una curva de
 * crecimiento realista entre ventanas, y simulan a propósito la
 * limitación real de TikTok (saves y retención no confiables vía API,
 * ver capa7-8-metrics-scoring.md sección 4) para poder probar ese camino
 * sin depender de un proveedor real.
 */

function seedFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WINDOW_FACTOR: Record<string, number> = { "24h": 0.3, "48h": 0.55, "72h": 0.75, "7d": 1.0 };

export const mockMetricsProvider: MetricsProvider = {
  name: "mock",

  async fetchSnapshot(req: MetricsSnapshotRequest): Promise<MetricsSnapshotResult> {
    await new Promise((resolve) => setTimeout(resolve, 150));

    const rand = mulberry32(seedFromString(req.provider_post_id));
    const windowFactor = WINDOW_FACTOR[req.window] ?? 1;

    const baseViews = 500 + Math.floor(rand() * 5000);
    const views = Math.round(baseViews * windowFactor);
    const engagementRate = 0.03 + rand() * 0.08;
    const likes = Math.round(views * engagementRate * 0.7);
    const comments = Math.round(views * engagementRate * 0.08);
    const shares = Math.round(views * engagementRate * 0.12);
    const follows = Math.round(views * 0.002 * rand());
    const profileVisits = Math.round(views * 0.01 * rand());

    const isTiktok = req.platform === "tiktok";
    const retentionRate = isTiktok ? null : Math.min(0.95, 0.25 + rand() * 0.4);

    return {
      ok: true,
      source: "api",
      confidence_level: isTiktok ? "medium" : "high",
      views,
      likes,
      comments,
      shares,
      saves: isTiktok ? null : Math.round(views * engagementRate * 0.1),
      follows,
      profile_visits: profileVisits,
      avg_watch_time_sec: isTiktok ? null : Math.round(8 + rand() * 20),
      retention_rate: retentionRate,
      completion_rate: isTiktok || retentionRate === null ? null : Math.min(0.9, retentionRate * 0.8),
      raw_payload: { mock: true, provider_post_id: req.provider_post_id, window: req.window },
      error_message: null,
      retryable: false,
    };
  },
};
