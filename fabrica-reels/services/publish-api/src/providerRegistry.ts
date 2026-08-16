import type { PublishProvider } from "./types";
import { mockProvider } from "./providers/mockProvider";
import { uploadPostProvider } from "./providers/uploadPostProvider";

/**
 * Único punto de la app que sabe qué proveedores existen. Agregar un
 * proveedor nuevo (Metricool, Publer, API oficial de Meta/TikTok) es
 * escribir un archivo en providers/ que implemente PublishProvider y
 * sumarlo acá -- nada más del sistema cambia.
 */
const registry: Record<string, PublishProvider> = {
  mock: mockProvider,
  upload_post: uploadPostProvider,
};

export function getProvider(name: string): PublishProvider | null {
  return registry[name] || null;
}
