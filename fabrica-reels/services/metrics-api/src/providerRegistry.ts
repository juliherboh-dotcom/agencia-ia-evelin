import type { MetricsProvider } from "./types";
import { mockMetricsProvider } from "./providers/mockMetricsProvider";
import { uploadPostMetricsProvider } from "./providers/uploadPostMetricsProvider";

/**
 * Único punto de la app que sabe qué proveedores de métricas existen.
 * Agregar uno nuevo (API oficial de Meta/TikTok, otro intermediario) es
 * escribir un archivo en providers/ que implemente MetricsProvider y
 * sumarlo acá.
 */
const registry: Record<string, MetricsProvider> = {
  mock: mockMetricsProvider,
  upload_post: uploadPostMetricsProvider,
};

export function getMetricsProvider(name: string): MetricsProvider | null {
  return registry[name] || null;
}
