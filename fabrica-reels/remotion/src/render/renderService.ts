/**
 * Servicio HTTP que n8n llama en la Capa 4, después de que el edit_spec
 * quedó en estado 'edit_spec_ready'. Es el punto exacto donde se aplica
 * "validar antes de renderizar": nunca se confía en que lo que está en
 * Supabase ya es válido, se revalida siempre antes de gastar un render.
 *
 * Variables de entorno esperadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import express from "express";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { validateEditSpec } from "../../../validation/validateEditSpec";
import { renderEditSpec } from "./renderEditSpec";

const app = express();
app.use(express.json({ limit: "2mb" }));

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

app.post("/render", async (req, res) => {
  const { edit_spec_id } = req.body as { edit_spec_id?: string };
  if (!edit_spec_id) {
    return res.status(400).json({ error: "Falta edit_spec_id" });
  }

  const { data: row, error } = await supabase
    .from("edit_specs")
    .select("id, spec_json")
    .eq("id", edit_spec_id)
    .single();

  if (error || !row) {
    return res.status(404).json({ error: "edit_spec no encontrado" });
  }

  const validation = validateEditSpec(row.spec_json);

  if (!validation.valid) {
    await supabase
      .from("edit_specs")
      .update({ validation_status: "invalid", validation_errors: validation.errors })
      .eq("id", edit_spec_id);

    return res.status(422).json({ error: "edit_spec inválido", details: validation.errors });
  }

  await supabase
    .from("edit_specs")
    .update({ validation_status: "valid" })
    .eq("id", edit_spec_id);

  const { data: renderRow, error: renderInsertError } = await supabase
    .from("renders")
    .insert({
      edit_spec_id,
      platform_variant: validation.data.platform,
      render_engine: "remotion_local",
      status: "rendering",
    })
    .select("id")
    .single();

  if (renderInsertError || !renderRow) {
    return res.status(500).json({ error: "No se pudo crear la fila de render" });
  }

  try {
    const outputLocation = path.join("/tmp/renders", `${validation.data.video_id}.mp4`);
    const startedAt = Date.now();

    await renderEditSpec(validation.data, outputLocation);

    await supabase
      .from("renders")
      .update({
        status: "done",
        storage_path: outputLocation, // el siguiente paso del workflow n8n sube esto a Supabase Storage
        render_time_sec: (Date.now() - startedAt) / 1000,
      })
      .eq("id", renderRow.id);

    return res.json({ ok: true, render_id: renderRow.id, output: outputLocation });
  } catch (renderError) {
    await supabase
      .from("renders")
      .update({ status: "failed" })
      .eq("id", renderRow.id);

    return res.status(500).json({ error: "Falló el render", details: String(renderError) });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, () => console.log(`Render service escuchando en :${PORT}`));
