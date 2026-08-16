import type { PublishJob, PublishProvider, PublishResult } from "../types";
import { providerError } from "../types";

/**
 * Proveedor de prueba: no llama a nada externo. Simula el comportamiento
 * de un proveedor real para poder probar todo el pipeline de Capa 6
 * (lock, guardado en Supabase, alertas, reintentos) sin gastar una
 * publicación real ni depender de credenciales de Upload-Post.
 *
 * Se controla con convenciones sobre el propio job, para poder forzar
 * cada rama del manejo de errores desde una prueba:
 *   - caption contiene "FORZAR_FALLO"      -> falla terminal (no retryable)
 *   - caption contiene "FORZAR_RATE_LIMIT" -> falla transitoria (retryable)
 *   - scheduled_at seteado                 -> responde "scheduled"
 *   - cualquier otro caso                  -> responde "published"
 */
export const mockProvider: PublishProvider = {
  name: "mock",

  async publish(job: PublishJob): Promise<PublishResult> {
    // Simula latencia de red real, para que el patrón async/lock del
    // workflow se ejerza de verdad en las pruebas.
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (job.caption.includes("FORZAR_FALLO")) {
      return providerError("Mock: fallo terminal simulado (caption inválido/cuenta desconectada)", false, "MOCK_TERMINAL_ERROR");
    }
    if (job.caption.includes("FORZAR_RATE_LIMIT")) {
      return providerError("Mock: rate limit simulado", true, "MOCK_RATE_LIMIT");
    }

    const fakePostId = `mock_${job.platform}_${Date.now()}`;

    if (job.scheduled_at) {
      return {
        ok: true,
        status: "scheduled",
        provider_post_id: fakePostId,
        provider_status: "MOCK_SCHEDULED",
        published_at: null,
        scheduled_at: job.scheduled_at,
        error_message: null,
        retryable: false,
      };
    }

    return {
      ok: true,
      status: "published",
      provider_post_id: fakePostId,
      provider_status: "MOCK_PUBLISHED",
      published_at: new Date().toISOString(),
      scheduled_at: null,
      error_message: null,
      retryable: false,
    };
  },

  async checkStatus(providerPostId: string): Promise<PublishResult> {
    return {
      ok: true,
      status: "published",
      provider_post_id: providerPostId,
      provider_status: "MOCK_PUBLISHED",
      published_at: new Date().toISOString(),
      scheduled_at: null,
      error_message: null,
      retryable: false,
    };
  },
};
