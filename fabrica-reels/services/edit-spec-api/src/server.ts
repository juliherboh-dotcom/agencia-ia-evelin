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
import { validateEditSpec } from "../../../validation/validateEditSpec";
import { buildRepairPrompt } from "../../../validation/repair-prompt";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PROMPTS_DIR = path.join(__dirname, "../../../prompts");

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

app.get("/prompts/edit-director-system", (_req, res) => {
  try {
    const rolePrompt = fs.readFileSync(
      path.join(PROMPTS_DIR, "edit-director-system-prompt.md"),
      "utf-8"
    );
    const brandVoice = fs.readFileSync(
      path.join(PROMPTS_DIR, "nexoia-brand-voice.md"),
      "utf-8"
    );
    res.json({ text: `${rolePrompt}\n\n---\n\n${brandVoice}` });
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

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.EDIT_SPEC_API_PORT ? Number(process.env.EDIT_SPEC_API_PORT) : 3002;
app.listen(PORT, () => console.log(`edit-spec-api escuchando en :${PORT}`));
