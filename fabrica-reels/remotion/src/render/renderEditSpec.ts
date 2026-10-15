import path from "path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { EditSpec } from "../../../schema/edit-spec.zod";

/**
 * Convierte un `template_id` (snake_case, ej. "prueba_social_v1") al id de
 * Composition registrado en Root.tsx (PascalCase, ej. "PruebaSocialV1").
 * Es la convención real de nombres que ya seguían "personal_brand_clean" →
 * "PersonalBrandClean" y "prueba_social_v1" → "PruebaSocialV1"; generalizarla
 * acá evita ir agregando un caso especial por cada template nuevo.
 */
function templateIdToCompositionId(templateId: string): string {
  return templateId
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

// No hay Chrome de sistema en el sandbox: usamos el Chromium que ya trae
// preinstalado el contenedor para Playwright en vez de dejar que Remotion
// intente descargar el suyo (falla, no hay salida de red a remotion.media).
const BROWSER_EXECUTABLE = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";

let cachedBundleLocation: string | null = null;

async function getBundleLocation(): Promise<string> {
  if (!cachedBundleLocation) {
    cachedBundleLocation = await bundle({
      entryPoint: path.join(__dirname, "../index.ts"),
    });
  }
  return cachedBundleLocation;
}

/**
 * Renderiza un EditSpec YA VALIDADO (nunca llamar esto con un JSON crudo
 * sin pasar antes por `validateEditSpec()` — ver render.ts/renderService.ts).
 */
export async function renderEditSpec(spec: EditSpec, outputLocation: string): Promise<void> {
  const serveUrl = await getBundleLocation();

  const composition = await selectComposition({
    serveUrl,
    id: templateIdToCompositionId(spec.template_id),
    inputProps: spec,
    browserExecutable: BROWSER_EXECUTABLE,
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps: spec,
    browserExecutable: BROWSER_EXECUTABLE,
    // El video fuente ya viene convertido a SDR/bt709 (ver scripts/tonemap-hdr.sh --
    // los iPhone graban HDR/HLG en bt2020 por defecto, y sin esto el output final
    // queda mal etiquetado (bt470bg) y se ve "lavado"/con más exposición que el
    // original -- el bug real reportado por Evelin, no una percepción suya.
    colorSpace: "bt709",
  });
}
