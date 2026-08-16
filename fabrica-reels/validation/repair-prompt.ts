import type { EditSpecValidationError } from "./validateEditSpec";

/**
 * Construye el prompt correctivo que se le manda de vuelta al LLM (Edit
 * Director) cuando `validateEditSpec()` rechaza su JSON. Se le pasan los
 * errores estructurados (mismo shape que usa la UI de revisión) para que
 * corrija quirúrgicamente, no que regenere todo de cero.
 */
export function buildRepairPrompt(
  originalJson: unknown,
  errors: EditSpecValidationError[]
): { system: string; user: string } {
  const system = `Eres el Edit Director de la Fábrica de Reels de Nexo.IA.
El JSON que generaste en el intento anterior NO pasó la validación del
sistema (schema edit-spec.schema.json v1.0.0).

Reglas para tu corrección:
- Corrige ÚNICAMENTE lo señalado en la lista de errores.
- No cambies cortes, subtítulos, overlays ni timings que no estén
  relacionados con un error listado.
- Todos los tiempos de "hook", "subtitles.lines", "overlays" y
  "zoom_keyframes" son relativos a la línea de tiempo FINAL ya editada
  (0 a duration.target_sec). Únicamente "cuts" usa los tiempos del video
  fuente original.
- Respeta los enums cerrados (template_id, platform, subtitles.style.position,
  overlays[].type, branding.watermark_position) — no inventes valores nuevos.
- Responde solo con el JSON corregido, completo, sin texto adicional, sin
  markdown y sin explicación.`;

  const user = `Errores encontrados (path + motivo):
${JSON.stringify(errors, null, 2)}

JSON original (inválido):
${JSON.stringify(originalJson, null, 2)}`;

  return { system, user };
}
