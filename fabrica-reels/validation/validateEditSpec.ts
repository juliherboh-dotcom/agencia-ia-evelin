/**
 * Validación en dos capas del EditSpec:
 *
 *  1. ESTRUCTURAL (Zod / EditSpecSchema): tipos, formatos, rangos, campos
 *     obligatorios, enums cerrados. Si falla acá, ni siquiera se evalúan
 *     las reglas semánticas.
 *
 *  2. SEMÁNTICA (runSemanticChecks, más abajo): reglas que dependen de
 *     comparar varios campos entre sí o recorrer arrays completos —
 *     cosas que un JSON Schema puro no puede expresar bien: cortes que no
 *     se solapan, subtítulos ordenados y dentro de la duración, overlays
 *     dentro del área segura de la plataforma, el hook apareciendo temprano.
 *
 * Ambas capas devuelven errores con el mismo shape ({path, message}) para
 * que se puedan mostrar igual en Airtable/portal, loguear igual, y
 * reutilizar igual en el prompt de reparación (ver repair-prompt.ts).
 */
import { EditSpecSchema, type EditSpec } from "../schema/edit-spec.zod";
import { isWithinSafeArea, SUBTITLE_POSITION_Y, type Platform } from "../schema/safe-areas";

export type EditSpecValidationError = { path: string; message: string };

export type EditSpecValidationResult =
  | { valid: true; data: EditSpec }
  | { valid: false; errors: EditSpecValidationError[] };

const DURATION_TOLERANCE = 0.2; // ±20% entre lo que suman los cortes "keep" y duration.target_sec
const MAX_HOOK_START_SEC = 4; // el hook tiene que aparecer dentro de los primeros 4s, si no ya no es hook

export function validateEditSpec(input: unknown): EditSpecValidationResult {
  const structural = EditSpecSchema.safeParse(input);

  if (!structural.success) {
    return {
      valid: false,
      errors: structural.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    };
  }

  const semanticErrors = runSemanticChecks(structural.data);
  if (semanticErrors.length > 0) {
    return { valid: false, errors: semanticErrors };
  }

  return { valid: true, data: structural.data };
}

function runSemanticChecks(spec: EditSpec): EditSpecValidationError[] {
  const errors: EditSpecValidationError[] = [];
  const platform = spec.platform as Platform;

  // 1. cuts: dentro del video fuente, sin solapes entre sí
  const sortedCuts = [...spec.cuts].sort((a, b) => a.start - b.start);
  sortedCuts.forEach((cut, i) => {
    if (cut.end > spec.source_video.duration_sec) {
      errors.push({
        path: `cuts[${i}].end`,
        message: `El corte termina en ${cut.end}s pero el video fuente dura ${spec.source_video.duration_sec}s`,
      });
    }
    const next = sortedCuts[i + 1];
    if (next && next.start < cut.end) {
      errors.push({
        path: `cuts[${i + 1}].start`,
        message: `Se solapa con el corte anterior (empieza en ${next.start}s, el anterior termina en ${cut.end}s)`,
      });
    }
  });

  // 2. la suma de los cortes conservados debe acercarse a la duración objetivo
  const keptDuration = spec.cuts
    .filter((c) => c.keep)
    .reduce((acc, c) => acc + (c.end - c.start), 0);
  const diff = Math.abs(keptDuration - spec.duration.target_sec);
  if (diff > spec.duration.target_sec * DURATION_TOLERANCE) {
    errors.push({
      path: "cuts",
      message: `La suma de cortes conservados (${keptDuration.toFixed(1)}s) se aleja más de ${
        DURATION_TOLERANCE * 100
      }% de la duración objetivo (${spec.duration.target_sec}s)`,
    });
  }

  // 3. subtítulos: ordenados, sin solapes, dentro de la línea de tiempo final
  const sortedLines = [...spec.subtitles.lines].sort((a, b) => a.start - b.start);
  sortedLines.forEach((line, i) => {
    if (line.end > spec.duration.target_sec) {
      errors.push({
        path: `subtitles.lines[${i}].end`,
        message: `El subtítulo "${line.text}" termina en ${line.end}s, después del final del video (${spec.duration.target_sec}s)`,
      });
    }
    const next = sortedLines[i + 1];
    if (next && next.start < line.end) {
      errors.push({
        path: `subtitles.lines[${i + 1}]`,
        message: `El subtítulo "${next.text}" (empieza en ${next.start}s) se solapa con "${line.text}" (termina en ${line.end}s)`,
      });
    }
  });

  // 4. safe area del bloque de subtítulos según la plataforma destino
  const subtitleY = SUBTITLE_POSITION_Y[spec.subtitles.style.position];
  if (!isWithinSafeArea({ x: 0.5, y: subtitleY }, platform)) {
    errors.push({
      path: "subtitles.style.position",
      message: `La posición "${spec.subtitles.style.position}" cae fuera del área segura de ${platform} (tapada por la UI nativa)`,
    });
  }

  // 5. overlays: dentro de la duración final y del área segura
  spec.overlays.forEach((overlay, i) => {
    if (overlay.end > spec.duration.target_sec) {
      errors.push({
        path: `overlays[${i}].end`,
        message: `El overlay "${overlay.id}" termina después del final del video`,
      });
    }
    if (!isWithinSafeArea(overlay.position, platform)) {
      errors.push({
        path: `overlays[${i}].position`,
        message: `El overlay "${overlay.id}" cae fuera del área segura de ${platform}`,
      });
    }
  });

  // 6. el hook debe empezar temprano y terminar dentro del video
  if (spec.hook.display_start > MAX_HOOK_START_SEC) {
    errors.push({
      path: "hook.display_start",
      message: `El hook empieza en ${spec.hook.display_start}s; debe aparecer dentro de los primeros ${MAX_HOOK_START_SEC}s`,
    });
  }
  if (spec.hook.display_end > spec.duration.target_sec) {
    errors.push({ path: "hook.display_end", message: "El hook termina después del final del video" });
  }

  // 7. zoom keyframes dentro de la duración final
  spec.zoom_keyframes.forEach((kf, i) => {
    if (kf.t > spec.duration.target_sec) {
      errors.push({
        path: `zoom_keyframes[${i}].t`,
        message: "Un keyframe de zoom cae después del final del video",
      });
    }
  });

  // 8. ejemplo de regla propia de un template: hook_fuerte_v1 exige hook desde el segundo 0
  if (spec.template_id === "hook_fuerte_v1" && spec.hook.display_start !== 0) {
    errors.push({
      path: "hook.display_start",
      message: `El template "hook_fuerte_v1" requiere que el hook arranque en el segundo 0`,
    });
  }

  return errors;
}
