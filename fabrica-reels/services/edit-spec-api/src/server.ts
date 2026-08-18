/**
 * edit-spec-api — servicio delgado de Capa 3.
 *
 * n8n orquesta el workflow (detectar video, traer contexto, llamar al LLM,
 * decidir el loop de reparación) pero delega en ESTE servicio la única
 * lógica que no debe vivir duplicada dentro de un nodo Code: la validación
 * real del edit_spec (`validateEditSpec`) y la construcción del prompt de
 * reparación (`buildRepairPrompt`) — ambas ya existen como funciones de
 * TypeScript probadas en `../../validation`, así que este servicio es
 * literalmente un wrapper HTTP sobre ellas, no una reimplementación.
 *
 * También sirve el system prompt del Edit Director armado (rol + reglas +
 * voz de marca) desde los archivos .md en `../../prompts`, para que esos
 * archivos sean la única fuente de verdad del prompt — nada de texto de
 * prompt duplicado dentro del workflow n8n.
 */
import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { validateEditSpec } from "../../../validation/validateEditSpec";
import { buildRepairPrompt } from "../../../validation/repair-prompt";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PROMPTS_DIR = path.join(__dirname, "../../../prompts");
const execFileAsync = promisify(execFile);

const supabaseHeaders = () => ({
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`,
  "Content-Type": "application/json",
});

app.post("/style-profiles", async (req, res) => {
  const { client_id, reference_video_urls, label } = req.body as {
    client_id?: string; reference_video_urls?: string[]; label?: string;
  };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!client_id || !uuid.test(client_id) || !label?.trim() || label.trim().length > 120 || !Array.isArray(reference_video_urls) || reference_video_urls.length === 0 || reference_video_urls.length > 20 || reference_video_urls.some((url) => typeof url !== "string" || !/^https?:\/\//.test(url))) {
    return res.status(400).json({ error: "client_id, label y reference_video_urls[] HTTP(S) son obligatorios" });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: "Supabase no esta configurado" });
  }
  try {
    const versionsResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/style_profiles?client_id=eq.${encodeURIComponent(client_id)}&select=version&order=version.desc&limit=1`, { headers: supabaseHeaders() });
    const versions = versionsResponse.ok ? await versionsResponse.json() as Array<{ version?: number }> : [];
    const version = Number(versions[0]?.version || 0) + 1;
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/style_profiles`, {
      method: "POST", headers: { ...supabaseHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({ client_id, label: label.trim(), source_video_refs: reference_video_urls, status: "pending", version }),
    });
    const body = await response.json();
    if (!response.ok) return res.status(502).json({ error: "No se pudo encolar el perfil", detail: body });
    return res.status(202).json({ queued: true, style_profile: Array.isArray(body) ? body[0] : body });
  } catch (error) {
    return res.status(502).json({ error: `No se pudo contactar Supabase: ${String(error)}` });
  }
});

app.post("/video-frames", async (req, res) => {
  const { video_url, timestamps, positions } = req.body as { video_url?: string; timestamps?: number[]; positions?: number[] };
  const requested = timestamps?.length ? timestamps : positions;
  if (!video_url || !/^https?:\/\//.test(video_url) || !requested?.length || requested.length > 20 || requested.some((value) => !Number.isFinite(value) || value < 0)) {
    return res.status(400).json({ error: "video_url y timestamps[] o positions[] son obligatorios" });
  }
  const workDir = path.join(os.tmpdir(), `reels-frames-${crypto.randomUUID()}`);
  await fs.promises.mkdir(workDir, { recursive: true });
  const videoPath = path.join(workDir, "source-video");
  try {
    const download = await fetch(video_url);
    if (!download.ok) throw new Error(`descarga HTTP ${download.status}`);
    await fs.promises.writeFile(videoPath, Buffer.from(await download.arrayBuffer()));
    let selected = timestamps;
    if (!selected?.length) {
      const probe = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", videoPath]);
      const duration = Number(probe.stdout.trim());
      if (!Number.isFinite(duration)) throw new Error("ffprobe no devolvio una duracion valida");
      if (positions!.some((position) => position > 1)) throw new Error("positions debe contener valores entre 0 y 1");
      selected = positions!.map((position) => position * duration);
    }
    const frames = [];
    for (const [index, timestamp] of selected!.entries()) {
      const output = path.join(workDir, `frame-${index}.jpg`);
      await execFileAsync("ffmpeg", ["-loglevel", "error", "-ss", String(timestamp), "-i", videoPath, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", "-y", output]);
      frames.push({ timestamp, media_type: "image/jpeg", data: (await fs.promises.readFile(output)).toString("base64") });
    }
    return res.json({ frames });
  } catch (error) {
    return res.status(422).json({ error: `No se pudieron extraer frames: ${String(error)}` });
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
});

app.post("/validate", (req, res) => {
  const { edit_spec } = req.body as { edit_spec?: unknown };
  const result = validateEditSpec(edit_spec);
  if (result.valid) {
    return res.json({ valid: true, data: result.data });
  }
  return res.json({ valid: false, errors: result.errors });
});

app.post("/repair-prompt", (req, res) => {
  const { edit_spec, errors } = req.body as {
    edit_spec: unknown;
    errors: { path: string; message: string }[];
  };
  const prompt = buildRepairPrompt(edit_spec, errors ?? []);
  res.json(prompt);
});

app.get("/prompts/edit-director-system", async (req, res) => {
  try {
    const rolePrompt = fs.readFileSync(
      path.join(PROMPTS_DIR, "edit-director-system-prompt.md"),
      "utf-8"
    );
    const brandVoice = fs.readFileSync(
      path.join(PROMPTS_DIR, "nexoia-brand-voice.md"),
      "utf-8"
    );
    let styleContext = "";
    const clientId = typeof req.query.client_id === "string" ? req.query.client_id : "";
    if (clientId && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/style_profiles?client_id=eq.${encodeURIComponent(clientId)}&status=eq.active&order=version.desc,created_at.desc&limit=1&select=fonts,color_palette,cut_pacing,card_patterns,audio_notes,version,label`, { headers: supabaseHeaders() });
      if (response.ok) {
        const profiles = await response.json() as unknown[];
        if (profiles[0]) styleContext = `\n\n---\n\n# PERFIL DE ESTILO ACTIVO DEL CLIENTE\n\nUsa este perfil como contexto visual preferente sin romper el schema. No inventes audio si figura no verificable.\n\n${JSON.stringify(profiles[0])}`;
      }
    }
    res.json({ text: `${rolePrompt}\n\n---\n\n${brandVoice}${styleContext}`, style_profile_applied: Boolean(styleContext) });
  } catch (err) {
    res.status(500).json({ error: `No se pudo leer el prompt: ${String(err)}` });
  }
});

app.get("/prompts/variant-director-system", (_req, res) => {
  try {
    const rolePrompt = fs.readFileSync(
      path.join(PROMPTS_DIR, "variant-director-system-prompt.md"),
      "utf-8"
    );
    const editRules = fs.readFileSync(
      path.join(PROMPTS_DIR, "edit-director-system-prompt.md"),
      "utf-8"
    );
    const brandVoice = fs.readFileSync(
      path.join(PROMPTS_DIR, "nexoia-brand-voice.md"),
      "utf-8"
    );
    res.json({ text: `${rolePrompt}\n\n---\n\n# REGLAS EDIT DIRECTOR PARA TIPO B\n\n${editRules}\n\n---\n\n${brandVoice}` });
  } catch (err) {
    res.status(500).json({ error: `No se pudo leer el prompt: ${String(err)}` });
  }
});

for (const [route, filename] of [["style-profile-system", "style-profile-system-prompt.md"], ["cut-qa-system", "cut-qa-system-prompt.md"]] as const) {
  app.get(`/prompts/${route}`, (_req, res) => {
    try { res.json({ text: fs.readFileSync(path.join(PROMPTS_DIR, filename), "utf-8") }); }
    catch (err) { res.status(500).json({ error: `No se pudo leer el prompt: ${String(err)}` }); }
  });
}

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.EDIT_SPEC_API_PORT ? Number(process.env.EDIT_SPEC_API_PORT) : 3002;
app.listen(PORT, () => console.log(`edit-spec-api escuchando en :${PORT}`));
