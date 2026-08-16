/**
 * Servicio HTTP de Capa 4 (render). Patrón asíncrono a propósito: un render
 * de Remotion puede tardar minutos, así que POST /render responde de
 * inmediato (siempre 200, ver contrato de `outcome` más abajo) y el trabajo
 * pesado (render + subida a Storage) sigue en background. Cuando termina
 * (bien o mal), este servicio avisa a n8n llamando a un webhook
 * (N8N_RENDER_CALLBACK_URL) — n8n nunca queda esperando una conexión HTTP
 * abierta varios minutos.
 *
 * Contrato deliberado: POST /render devuelve SIEMPRE HTTP 200 (salvo un
 * crash realmente inesperado), con un campo `outcome` que dice qué pasó.
 * Esto es a propósito para que el nodo Code de n8n que llama a este
 * endpoint nunca tenga que lidiar con "¿este framework de HTTP tira
 * excepción en 4xx o no?" — solo lee `outcome` del body.
 *
 * Variables de entorno esperadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * N8N_RENDER_CALLBACK_URL, MAX_RENDER_SIZE_MB (opcional, default 100),
 * RENDER_SERVICE_PORT (opcional, default 3001).
 */
import express from "express";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { validateEditSpec } from "../../../validation/validateEditSpec";
import { renderEditSpec } from "./renderEditSpec";
import type { EditSpec } from "../../../schema/edit-spec.zod";

const app = express();
app.use(express.json({ limit: "2mb" }));

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const MAX_RENDER_SIZE_MB = process.env.MAX_RENDER_SIZE_MB
  ? Number(process.env.MAX_RENDER_SIZE_MB)
  : 100;
const N8N_RENDER_CALLBACK_URL = process.env.N8N_RENDER_CALLBACK_URL;
const STORAGE_BUCKET = "renders";
const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7; // 7 días -- de sobra para revisar y aprobar

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/render", async (req, res) => {
  const { edit_spec_id } = req.body as { edit_spec_id?: string };
  if (!edit_spec_id) {
    return res.status(200).json({ ok: false, outcome: "missing_input", message: "Falta edit_spec_id" });
  }

  const { data: specRow, error: specError } = await supabase
    .from("edit_specs")
    .select("id, raw_video_id, spec_json")
    .eq("id", edit_spec_id)
    .single();

  if (specError || !specRow) {
    return res.status(200).json({ ok: false, outcome: "not_found", message: "edit_spec no encontrado" });
  }

  // Idempotencia: nunca se renderiza dos veces el mismo edit_spec. Se mira
  // el último intento (por edit_spec_id) y se decide en base a su estado.
  const { data: existing } = await supabase
    .from("renders")
    .select("id, status, public_url, attempt")
    .eq("edit_spec_id", edit_spec_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && existing.status === "done") {
    return res.status(200).json({
      ok: true,
      outcome: "already_done",
      render_id: existing.id,
      public_url: existing.public_url,
    });
  }
  if (existing && (existing.status === "queued" || existing.status === "rendering")) {
    return res.status(200).json({ ok: true, outcome: "already_in_progress", render_id: existing.id });
  }

  // Revalidar SIEMPRE antes de gastar un render -- nunca confiar en que lo
  // guardado en Capa 3 sigue siendo válido (pudo cambiar el schema, o
  // alguien tocó la fila a mano).
  const validation = validateEditSpec(specRow.spec_json);
  if (!validation.valid) {
    await supabase
      .from("edit_specs")
      .update({ validation_status: "invalid", validation_errors: validation.errors })
      .eq("id", edit_spec_id);
    return res.status(200).json({ ok: false, outcome: "invalid_edit_spec", errors: validation.errors });
  }

  const { data: renderRow, error: insertError } = await supabase
    .from("renders")
    .insert({
      edit_spec_id,
      raw_video_id: specRow.raw_video_id,
      platform_variant: validation.data.platform,
      render_engine: "remotion_local",
      status: "queued",
      attempt: (existing?.attempt ?? 0) + 1,
    })
    .select("id")
    .single();

  if (insertError || !renderRow) {
    return res.status(200).json({ ok: false, outcome: "internal_error", message: "No se pudo crear la fila de render" });
  }

  // Responder YA. El trabajo real sigue después de este return.
  res.status(200).json({ ok: true, outcome: "queued", render_id: renderRow.id });

  processRenderInBackground(renderRow.id, specRow.raw_video_id, validation.data).catch((err) => {
    console.error(`Error no controlado procesando render ${renderRow.id}:`, err);
  });
});

app.get("/render/:id", async (req, res) => {
  const { data, error } = await supabase.from("renders").select("*").eq("id", req.params.id).single();
  if (error || !data) return res.status(404).json({ error: "render no encontrado" });
  res.json(data);
});

// Capa 5: botón "🔗 Regenerar link" -- las URLs firmadas duran 7 días: si
// un video queda mucho tiempo en revisión, el link que ya se mandó por
// Telegram puede morir antes de que alguien lo revise. Re-firma el mismo
// objeto de Storage sin volver a renderizar nada.
app.post("/renders/:id/refresh-link", async (req, res) => {
  const { data: render, error } = await supabase
    .from("renders")
    .select("id, storage_path, status")
    .eq("id", req.params.id)
    .single();

  if (error || !render || render.status !== "done" || !render.storage_path) {
    return res.status(404).json({ error: "render no encontrado o sin archivo asociado" });
  }

  const objectPath = render.storage_path.replace(`${STORAGE_BUCKET}/`, "");
  const { data: signed, error: signError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SEC);

  if (signError || !signed) {
    return res.status(500).json({ error: "no se pudo regenerar la URL firmada" });
  }

  await supabase
    .from("renders")
    .update({ public_url: signed.signedUrl, updated_at: new Date().toISOString() })
    .eq("id", render.id);

  res.json({ ok: true, public_url: signed.signedUrl });
});

async function processRenderInBackground(renderId: string, rawVideoId: string, spec: EditSpec) {
  await supabase.from("renders").update({ status: "rendering", updated_at: new Date().toISOString() }).eq("id", renderId);

  const outputLocation = path.join("/tmp/renders", `${spec.video_id}.mp4`);
  const startedAt = Date.now();

  try {
    await renderEditSpec(spec, outputLocation);
  } catch (renderError) {
    return failRender(renderId, rawVideoId, spec.video_id, "render", String(renderError));
  }

  const stats = fs.statSync(outputLocation);
  const sizeMb = stats.size / (1024 * 1024);
  if (sizeMb > MAX_RENDER_SIZE_MB) {
    fs.rmSync(outputLocation, { force: true });
    return failRender(
      renderId,
      rawVideoId,
      spec.video_id,
      "upload",
      `El render pesa ${sizeMb.toFixed(1)}MB, excede el límite configurado (MAX_RENDER_SIZE_MB=${MAX_RENDER_SIZE_MB}MB)`
    );
  }

  const renderTimeSec = (Date.now() - startedAt) / 1000;
  const storageObjectPath = `${spec.client_id}/${spec.video_id}.mp4`;

  let publicUrl: string;
  try {
    const fileBuffer = fs.readFileSync(outputLocation);
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storageObjectPath, fileBuffer, { contentType: "video/mp4", upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    const { data: signed, error: signError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storageObjectPath, SIGNED_URL_TTL_SEC);
    if (signError || !signed) throw new Error(signError?.message ?? "no se pudo firmar la URL de revisión");
    publicUrl = signed.signedUrl;
  } catch (uploadError) {
    return failRender(renderId, rawVideoId, spec.video_id, "upload", String(uploadError));
  } finally {
    fs.rmSync(outputLocation, { force: true });
  }

  await supabase
    .from("renders")
    .update({
      status: "done",
      storage_path: `${STORAGE_BUCKET}/${storageObjectPath}`,
      public_url: publicUrl,
      render_time_sec: renderTimeSec,
      updated_at: new Date().toISOString(),
    })
    .eq("id", renderId);

  await notifyN8n({
    render_id: renderId,
    raw_video_id: rawVideoId,
    video_id: spec.video_id,
    status: "done",
    public_url: publicUrl,
    render_time_sec: renderTimeSec,
  });
}

async function failRender(
  renderId: string,
  rawVideoId: string,
  videoId: string,
  stage: "render" | "upload",
  errorMessage: string
) {
  await supabase
    .from("renders")
    .update({ status: "failed", error_message: errorMessage, stage, updated_at: new Date().toISOString() })
    .eq("id", renderId);

  await notifyN8n({
    render_id: renderId,
    raw_video_id: rawVideoId,
    video_id: videoId,
    status: "failed",
    stage,
    error: errorMessage,
  });
}

async function notifyN8n(payload: Record<string, unknown>) {
  if (!N8N_RENDER_CALLBACK_URL) {
    console.warn("N8N_RENDER_CALLBACK_URL no configurado -- n8n no se entera del resultado de este render.");
    return;
  }
  try {
    await fetch(N8N_RENDER_CALLBACK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Si esto falla, el sweep de Capa 4 (timeout) eventualmente lo detecta
    // como render "colgado" si nunca se actualizó -- pero acá SÍ se
    // actualizó la fila `renders`, así que un GET /render/:id manual
    // también sirve de red de seguridad mientras tanto.
    console.error("No se pudo notificar a n8n el resultado del render:", err);
  }
}

const PORT = process.env.RENDER_SERVICE_PORT ? Number(process.env.RENDER_SERVICE_PORT) : 3001;
app.listen(PORT, () => console.log(`Render service escuchando en :${PORT}`));
