/**
 * Fallback manual de Capa 7: cuando el proveedor no expone una métrica
 * (el caso típico: guardados/retención de TikTok) alguien la anota a
 * mano después de mirar TikTok Studio / Instagram Insights, en un CSV
 * simple, y este script la sube.
 *
 * Uso:
 *   npm run import-csv -- ./metricas-manuales.csv
 *
 * Columnas esperadas (con encabezado, separadas por coma):
 *   publication_id,window,views,likes,comments,shares,saves,follows,profile_visits,avg_watch_time_sec,retention_rate,completion_rate
 *
 * Los campos que no se tengan se dejan vacíos -- se guardan como NULL,
 * nunca como 0 (0 es un dato real, "no lo sé" no lo es).
 *
 * Env vars usadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, METRICS_API_URL
 */
import fs from "fs";
import readline from "readline";
import type { MetricsSnapshotResult } from "../src/types";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const METRICS_API_URL = process.env.METRICS_API_URL || "http://localhost:3004";

const NUMERIC_FIELDS = [
  "views", "likes", "comments", "shares", "saves", "follows",
  "profile_visits", "avg_watch_time_sec", "retention_rate", "completion_rate",
];

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Uso: npm run import-csv -- ./archivo.csv");
    process.exit(1);
  }

  const rl = readline.createInterface({ input: fs.createReadStream(path) });
  let header: string[] | null = null;
  let ok = 0;
  let failed = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const cells = line.split(",").map((c) => c.trim());

    if (!header) {
      header = cells;
      continue;
    }

    const row: Record<string, string> = {};
    header.forEach((col, i) => { row[col] = cells[i] ?? ""; });

    const publicationId = row.publication_id;
    const window = row.window;
    if (!publicationId || !window) {
      console.error(`Fila sin publication_id/window, se salta: ${line}`);
      failed++;
      continue;
    }

    const manualPayload: Record<string, number | null> = {};
    for (const field of NUMERIC_FIELDS) {
      manualPayload[field] = row[field] && row[field] !== "" ? Number(row[field]) : null;
    }

    // 1. Pedirle a metrics-api que arme el shape estándar (source='manual').
    const snapshotRes = await fetch(`${METRICS_API_URL}/metrics/manual`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(manualPayload),
    });
    const snapshot = (await snapshotRes.json()) as MetricsSnapshotResult;

    // 2. Traer contexto de la publicación para poblar la fila completa.
    const pubRes = await fetch(
      `${SUPABASE_URL}/rest/v1/publications?id=eq.${publicationId}&select=client_id,platform,render_id,raw_video_id,account_id`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const pubRows = (await pubRes.json()) as Record<string, string>[];
    const [pub] = pubRows;
    if (!pub) {
      console.error(`publication_id ${publicationId} no encontrado, se salta`);
      failed++;
      continue;
    }

    // 3. Insertar en post_metrics (falla si ya existe esa ventana --
    // índice único de la migración, no se sobreescribe silenciosamente).
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/post_metrics`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        publication_id: publicationId,
        client_id: pub.client_id,
        raw_video_id: pub.raw_video_id,
        render_id: pub.render_id,
        account_id: pub.account_id,
        platform: pub.platform,
        snapshot_window: window,
        snapshot_at: new Date().toISOString(),
        views: snapshot.views,
        likes: snapshot.likes,
        comments: snapshot.comments,
        shares: snapshot.shares,
        saves: snapshot.saves,
        follows: snapshot.follows,
        profile_visits: snapshot.profile_visits,
        avg_watch_time: snapshot.avg_watch_time_sec,
        retention_rate: snapshot.retention_rate,
        completion_rate: snapshot.completion_rate,
        engagement_rate:
          snapshot.views
            ? ((snapshot.likes || 0) + (snapshot.comments || 0) + (snapshot.shares || 0) + (snapshot.saves || 0)) / snapshot.views
            : null,
        raw_payload: snapshot.raw_payload,
        source: "manual",
        confidence_level: snapshot.confidence_level,
      }),
    });

    if (insertRes.ok) {
      ok++;
      console.log(`OK: ${publicationId} (${window})`);
    } else {
      failed++;
      console.error(`FALLÓ: ${publicationId} (${window}) -- ${await insertRes.text()}`);
    }
  }

  console.log(`\nImportación terminada: ${ok} ok, ${failed} fallidas.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
