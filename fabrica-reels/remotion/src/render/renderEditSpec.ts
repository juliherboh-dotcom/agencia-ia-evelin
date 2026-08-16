import path from "path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { EditSpec } from "../../../schema/edit-spec.zod";

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
    id: spec.template_id === "personal_brand_clean" ? "PersonalBrandClean" : spec.template_id,
    inputProps: spec,
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation,
    inputProps: spec,
  });
}
