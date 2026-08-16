/**
 * Contrato interno de Capa 6. Todo lo que hable con un proveedor externo
 * (Upload-Post hoy, Metricool/Publer/API oficial mañana) entra por
 * `PublishJob` y sale por `PublishResult` -- n8n y Supabase nunca ven la
 * forma específica de un proveedor, solo este contrato. Cambiar de
 * proveedor es escribir un nuevo archivo en `providers/` que implemente
 * `PublishProvider`, no tocar el workflow ni el modelo de datos.
 */

export type Platform = "tiktok" | "instagram_reels";

export interface PublishJob {
  publication_id: string;
  client_id: string;
  platform: Platform;
  provider: string; // "mock" | "upload_post" | futuro: "metricool" | "meta_direct" | "tiktok_direct"
  account_external_id: string; // identificador de la cuenta YA conectada del lado del proveedor
  video_url: string; // URL accesible del MP4 (renders.public_url)
  caption: string; // caption final, ya con hashtags incluidos si el proveedor los espera así
  scheduled_at: string | null; // ISO 8601 UTC; null = publicar ya
}

export type PublishStatus =
  | "published" // confirmado en vivo, hay provider_post_id
  | "scheduled" // el proveedor lo tiene agendado, todavía no se publicó
  | "failed" // terminal, no se reintenta solo
  | "rate_limited" // transitorio, reintentar más tarde con backoff
  | "pending"; // el proveedor lo aceptó pero todavía no confirma nada (poco común, se trata como retryable)

export interface PublishResult {
  ok: boolean;
  status: PublishStatus;
  provider_post_id: string | null;
  provider_status: string | null; // texto crudo devuelto por el proveedor, para debugging
  published_at: string | null; // ISO 8601 UTC, solo si status='published'
  scheduled_at: string | null; // ISO 8601 UTC, solo si status='scheduled'
  error_message: string | null;
  retryable: boolean; // true = vale la pena reintentar automáticamente (con backoff)
}

export interface PublishProvider {
  name: string;
  publish(job: PublishJob): Promise<PublishResult>;
  /** Opcional: algunos proveedores requieren consultar el estado por separado (async real del lado del proveedor). */
  checkStatus?(providerPostId: string, platform: Platform): Promise<PublishResult>;
}

/** Error interno estandarizado para que los adapters no tengan que reinventar el shape. */
export function providerError(message: string, retryable: boolean, providerStatus: string | null = null): PublishResult {
  return {
    ok: false,
    status: retryable ? "rate_limited" : "failed",
    provider_post_id: null,
    provider_status: providerStatus,
    published_at: null,
    scheduled_at: null,
    error_message: message,
    retryable,
  };
}
