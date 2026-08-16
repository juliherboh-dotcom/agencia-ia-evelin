/**
 * publish-api -- servicio delgado de Capa 6.
 *
 * n8n orquesta (detecta publicaciones listas, hace el locking, decide
 * cuándo reintentar) pero delega en ESTE servicio la única lógica que no
 * debe vivir duplicada en un nodo Code: hablar con el proveedor externo
 * concreto. n8n solo conoce `PublishJob`/`PublishResult` -- nunca la
 * forma específica de Upload-Post, Metricool, o lo que sea.
 */
import express from "express";
import { getProvider } from "./providerRegistry";
import type { PublishJob } from "./types";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/publish", async (req, res) => {
  const job = req.body as Partial<PublishJob>;

  const requiredFields: (keyof PublishJob)[] = [
    "publication_id",
    "client_id",
    "platform",
    "provider",
    "account_external_id",
    "video_url",
    "caption",
  ];
  const missing = requiredFields.filter((f) => !job[f]);
  if (missing.length > 0) {
    return res.status(200).json({
      ok: false,
      status: "failed",
      provider_post_id: null,
      provider_status: null,
      published_at: null,
      scheduled_at: null,
      error_message: `Faltan campos obligatorios en el PublishJob: ${missing.join(", ")}`,
      retryable: false,
    });
  }

  const provider = getProvider(job.provider as string);
  if (!provider) {
    return res.status(200).json({
      ok: false,
      status: "failed",
      provider_post_id: null,
      provider_status: null,
      published_at: null,
      scheduled_at: null,
      error_message: `Proveedor desconocido: "${job.provider}"`,
      retryable: false,
    });
  }

  try {
    const result = await provider.publish(job as PublishJob);
    return res.status(200).json(result);
  } catch (err) {
    // Cualquier excepción no controlada del adapter se trata como
    // transitoria -- mejor reintentar de más que dejar una publicación
    // colgada por un bug puntual del adapter.
    return res.status(200).json({
      ok: false,
      status: "rate_limited",
      provider_post_id: null,
      provider_status: null,
      published_at: null,
      scheduled_at: null,
      error_message: `Error no controlado en el adapter: ${String(err)}`,
      retryable: true,
    });
  }
});

const PORT = process.env.PUBLISH_API_PORT ? Number(process.env.PUBLISH_API_PORT) : 3003;
app.listen(PORT, () => console.log(`publish-api escuchando en :${PORT}`));
