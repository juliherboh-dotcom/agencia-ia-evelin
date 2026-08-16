import type { PublishJob, PublishProvider, PublishResult } from "../types";
import { providerError } from "../types";

/**
 * Adapter para Upload-Post (https://upload-post.com) -- proveedor
 * recomendado para Capa 6 (ver capa6-publishing.md, sección 1). Es
 * API-first y pensado para automatización multi-cuenta: cada cliente
 * conecta su Instagram/TikTok una vez (link OAuth hospedado por
 * Upload-Post) y queda identificado acá por un `profile`/`user` que
 * Upload-Post asigna -- nunca guardamos el token de Instagram/TikTok del
 * cliente nosotros mismos.
 *
 * ⚠️ VERIFICAR ANTES DE PRODUCCIÓN: el endpoint exacto, el nombre de los
 * campos del form y el shape de la respuesta pueden haber cambiado desde
 * que se escribió este adapter -- las APIs de este tipo de proveedores
 * evolucionan. Confirmar contra la documentación vigente de Upload-Post
 * antes de depender de esto en producción; si algo cambió, el único
 * archivo que hay que tocar es este.
 *
 * Env vars usadas: UPLOAD_POST_API_KEY, UPLOAD_POST_API_URL (default
 * https://api.upload-post.com/api).
 */

const API_URL = process.env.UPLOAD_POST_API_URL || "https://api.upload-post.com/api";
const API_KEY = process.env.UPLOAD_POST_API_KEY;

// Upload-Post usa un nombre de plataforma propio por endpoint; este mapa
// es el punto único de traducción entre nuestro contrato y el suyo.
const PLATFORM_MAP: Record<string, string> = {
  tiktok: "tiktok",
  instagram_reels: "instagram",
};

export const uploadPostProvider: PublishProvider = {
  name: "upload_post",

  async publish(job: PublishJob): Promise<PublishResult> {
    if (!API_KEY) {
      return providerError("UPLOAD_POST_API_KEY no configurada", false);
    }

    const providerPlatform = PLATFORM_MAP[job.platform];
    if (!providerPlatform) {
      return providerError(`Plataforma "${job.platform}" no soportada por este adapter`, false);
    }

    // El video vive en Supabase Storage (URL firmada). Se descarga acá y
    // se sube como multipart al proveedor en vez de asumir que soporta
    // "pasale una URL y la baja él" -- es el camino más portable entre
    // proveedores de este tipo.
    let videoBlob: Blob;
    try {
      const videoRes = await fetch(job.video_url);
      if (!videoRes.ok) {
        return providerError(`No se pudo descargar el video fuente (HTTP ${videoRes.status}) -- posible link vencido`, true);
      }
      videoBlob = await videoRes.blob();
    } catch (err) {
      return providerError(`Error de red descargando el video fuente: ${String(err)}`, true);
    }

    const form = new FormData();
    form.append("user", job.account_external_id);
    form.append("title", job.caption);
    form.append("platform[]", providerPlatform);
    form.append("video", videoBlob, `${job.publication_id}.mp4`);
    if (job.scheduled_at) {
      form.append("scheduled_date", job.scheduled_at);
    }

    let response: Response;
    try {
      response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        headers: { Authorization: `Apikey ${API_KEY}` },
        body: form,
      });
    } catch (err) {
      return providerError(`Error de red llamando a Upload-Post: ${String(err)}`, true);
    }

    if (response.status === 401 || response.status === 403) {
      return providerError("Token/cuenta de Upload-Post vencido o sin permisos para esta cuenta -- requiere reconectar", false, `HTTP_${response.status}`);
    }
    if (response.status === 429) {
      return providerError("Rate limit de Upload-Post", true, "HTTP_429");
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return providerError(`Upload-Post devolvió HTTP ${response.status}: ${bodyText.slice(0, 300)}`, response.status >= 500, `HTTP_${response.status}`);
    }

    const body = (await response.json()) as {
      success?: boolean;
      results?: Record<string, { success?: boolean; post_id?: string; error?: string }>;
    };

    const platformResult = body.results ? body.results[providerPlatform] : undefined;

    if (!body.success || !platformResult || platformResult.success === false) {
      const errorMessage = platformResult?.error || "Upload-Post reportó éxito general pero falló para esta plataforma";
      return providerError(errorMessage, true, JSON.stringify(body).slice(0, 300));
    }

    return {
      ok: true,
      status: job.scheduled_at ? "scheduled" : "published",
      provider_post_id: platformResult.post_id || null,
      provider_status: "OK",
      published_at: job.scheduled_at ? null : new Date().toISOString(),
      scheduled_at: job.scheduled_at,
      error_message: null,
      retryable: false,
    };
  },
};
