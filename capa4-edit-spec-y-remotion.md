# Capa 3→4: el contrato `edit_spec` y la primera Composition Remotion

**Contexto:** desarrollo de `sistema-fabrica-reels-nexoia.md`, Capa 3 (Edit Director) → Capa 4 (Render).
**Código real:** todo lo de este documento vive también como archivos ejecutables en [`fabrica-reels/`](./fabrica-reels) — este markdown es la explicación narrativa, los archivos son la fuente de verdad.

**Decisión de fondo, antes de leer el resto:** el `edit_spec` tiene **dos capas de validación separadas**, porque son problemas de naturaleza distinta:
- **Estructural** (tipos, formatos, enums, rangos) → JSON Schema + Zod. Esto es lo que un `additionalProperties:false` y un `enum` cerrado pueden atrapar.
- **Semántica** (reglas de negocio que cruzan varios campos: cortes que no se solapan, subtítulos ordenados, overlays dentro del área segura) → una función TypeScript. Un JSON Schema puro no expresa bien "el elemento i+1 no puede empezar antes de que termine el elemento i" sobre un array arbitrario.

Y una regla de diseño que hay que tener clara antes de leer los ejemplos: **`cuts[].start/end` usan la línea de tiempo del video FUENTE original. Todo lo demás (`hook`, `subtitles.lines`, `overlays`, `zoom_keyframes`) usa la línea de tiempo FINAL ya editada**, de 0 a `duration.target_sec`. Es la ambigüedad más fácil de meter la pata si no se deja explícita desde el día 1.

---

## 1. JSON Schema completo del `edit_spec`

Archivo: [`fabrica-reels/schema/edit-spec.schema.json`](./fabrica-reels/schema/edit-spec.schema.json)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://nexo-ia.cl/schemas/edit-spec.schema.json",
  "title": "EditSpec",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version", "video_id", "client_id", "raw_video_id", "template_id",
    "platform", "aspect_ratio", "source_video", "duration", "cuts", "hook",
    "subtitles", "branding", "meta"
  ],
  "properties": {
    "schema_version": { "const": "1.0.0" },
    "video_id": { "type": "string", "pattern": "^VID-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3,}$" },
    "client_id": { "type": "string", "format": "uuid" },
    "raw_video_id": { "type": "string", "format": "uuid" },
    "template_id": {
      "type": "string",
      "enum": ["educativo_v1", "historia_v1", "venta_v1", "hook_fuerte_v1", "prueba_social_v1", "personal_brand_clean"]
    },
    "platform": { "type": "string", "enum": ["tiktok", "instagram_reels"] },
    "aspect_ratio": { "const": "9:16" },
    "canvas": {
      "type": "object", "additionalProperties": false,
      "properties": { "width": { "const": 1080 }, "height": { "const": 1920 } },
      "default": { "width": 1080, "height": 1920 }
    },
    "source_video": {
      "type": "object", "additionalProperties": false,
      "required": ["url", "duration_sec"],
      "properties": {
        "url": { "type": "string", "format": "uri" },
        "duration_sec": { "type": "number", "exclusiveMinimum": 0, "maximum": 1800 }
      }
    },
    "duration": {
      "type": "object", "additionalProperties": false, "required": ["target_sec"],
      "properties": { "target_sec": { "type": "number", "minimum": 5, "maximum": 90 } }
    },
    "cuts": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/cut" } },
    "hook": { "$ref": "#/$defs/hook" },
    "subtitles": {
      "type": "object", "additionalProperties": false, "required": ["style", "lines"],
      "properties": {
        "style": { "$ref": "#/$defs/subtitleStyle" },
        "lines": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/captionLine" } }
      }
    },
    "overlays": { "type": "array", "default": [], "items": { "$ref": "#/$defs/overlay" } },
    "zoom_keyframes": { "type": "array", "default": [], "items": { "$ref": "#/$defs/zoomKeyframe" } },
    "progress_bar": {
      "type": "object", "additionalProperties": false,
      "properties": { "enabled": { "type": "boolean" }, "color": { "$ref": "#/$defs/hexColor" } },
      "default": { "enabled": true, "color": "#F2A93B" }
    },
    "branding": { "$ref": "#/$defs/branding" },
    "end_card": {
      "type": "object", "additionalProperties": false, "required": ["enabled"],
      "properties": {
        "enabled": { "type": "boolean" },
        "cta_text": { "type": "string", "maxLength": 60 },
        "duration_sec": { "type": "number", "minimum": 1, "maximum": 4 }
      }
    },
    "music": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "track_id": { "type": "string" },
        "volume_db": { "type": "number", "minimum": -60, "maximum": 0 }
      }
    },
    "meta": {
      "type": "object", "additionalProperties": false,
      "required": ["created_by", "created_at", "version"],
      "properties": {
        "created_by": { "type": "string", "enum": ["llm_edit_director", "human_edit", "llm_repair"] },
        "created_at": { "type": "string", "format": "date-time" },
        "version": { "type": "integer", "minimum": 1 }
      }
    }
  },
  "$defs": {
    "hexColor": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
    "position": {
      "type": "object", "additionalProperties": false, "required": ["x", "y"],
      "properties": {
        "x": { "type": "number", "minimum": 0, "maximum": 1 },
        "y": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "cut": {
      "type": "object", "additionalProperties": false, "required": ["start", "end", "keep"],
      "properties": {
        "start": { "type": "number", "minimum": 0 },
        "end": { "type": "number", "minimum": 0 },
        "keep": { "type": "boolean" },
        "reason": { "type": "string", "maxLength": 120 }
      }
    },
    "hook": {
      "type": "object", "additionalProperties": false,
      "required": ["text", "display_start", "display_end"],
      "properties": {
        "text": { "type": "string", "minLength": 1, "maxLength": 90 },
        "emphasis_words": { "type": "array", "items": { "type": "string" }, "default": [] },
        "display_start": { "type": "number", "minimum": 0 },
        "display_end": { "type": "number", "minimum": 0 }
      }
    },
    "subtitleStyle": {
      "type": "object", "additionalProperties": false,
      "required": ["font_family", "font_size", "color", "highlight_color", "position"],
      "properties": {
        "font_family": { "type": "string" },
        "font_size": { "type": "integer", "minimum": 28, "maximum": 96 },
        "color": { "$ref": "#/$defs/hexColor" },
        "highlight_color": { "$ref": "#/$defs/hexColor" },
        "position": { "type": "string", "enum": ["top", "center", "bottom"] }
      }
    },
    "captionLine": {
      "type": "object", "additionalProperties": false, "required": ["start", "end", "text"],
      "properties": {
        "start": { "type": "number", "minimum": 0 },
        "end": { "type": "number", "minimum": 0 },
        "text": { "type": "string", "minLength": 1, "maxLength": 80 },
        "emphasis": { "type": "boolean", "default": false }
      }
    },
    "overlay": {
      "type": "object", "additionalProperties": false, "required": ["id", "type", "start", "end", "position"],
      "properties": {
        "id": { "type": "string" },
        "type": { "type": "string", "enum": ["text", "image", "badge"] },
        "text": { "type": "string", "maxLength": 60 },
        "image_url": { "type": "string", "format": "uri" },
        "start": { "type": "number", "minimum": 0 },
        "end": { "type": "number", "minimum": 0 },
        "position": { "$ref": "#/$defs/position" }
      }
    },
    "zoomKeyframe": {
      "type": "object", "additionalProperties": false, "required": ["t", "scale"],
      "properties": {
        "t": { "type": "number", "minimum": 0 },
        "scale": { "type": "number", "minimum": 1.0, "maximum": 1.6 },
        "focus": { "type": "string", "enum": ["center", "top", "bottom"], "default": "center" }
      }
    },
    "branding": {
      "type": "object", "additionalProperties": false,
      "required": ["logo_url", "primary_color", "accent_color", "handle"],
      "properties": {
        "logo_url": { "type": "string", "format": "uri" },
        "primary_color": { "$ref": "#/$defs/hexColor" },
        "accent_color": { "$ref": "#/$defs/hexColor" },
        "handle": { "type": "string", "pattern": "^@[a-zA-Z0-9._]{2,30}$" },
        "watermark_position": {
          "type": "string",
          "enum": ["top_left", "top_right", "bottom_left", "bottom_right"],
          "default": "bottom_right"
        }
      }
    }
  }
}
```

*(Schema completo con descripciones en el archivo real — acá se omitieron para legibilidad.)*

---

## 2. Ejemplo real de `edit_spec` válido

Archivo: [`fabrica-reels/schema/examples/valid-edit-spec.json`](./fabrica-reels/schema/examples/valid-edit-spec.json) (es el mismo que usa Remotion Studio como `defaultProps` en `sample-data/example-edit-spec.json`).

```json
{
  "schema_version": "1.0.0",
  "video_id": "VID-2026-08-16-001",
  "client_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "raw_video_id": "9b2f1e3a-6c4d-4a2b-8e1f-2d3c4b5a6e7f",
  "template_id": "personal_brand_clean",
  "platform": "instagram_reels",
  "aspect_ratio": "9:16",
  "canvas": { "width": 1080, "height": 1920 },
  "source_video": {
    "url": "https://storage.nexo-ia.cl/raw/3fa85f64-5717-4562-b3fc-2c963f66afa6/VID-2026-08-16-001.mp4",
    "duration_sec": 45
  },
  "duration": { "target_sec": 38 },
  "cuts": [
    { "start": 0.0, "end": 9.0, "keep": true },
    { "start": 9.0, "end": 10.6, "keep": false, "reason": "silencio antes de la segunda idea" },
    { "start": 10.6, "end": 27.0, "keep": true },
    { "start": 27.0, "end": 29.0, "keep": false, "reason": "muletilla 'o sea'" },
    { "start": 29.0, "end": 45.0, "keep": true }
  ],
  "hook": {
    "text": "Esto cambió mi forma de vender",
    "emphasis_words": ["cambió", "vender"],
    "display_start": 0,
    "display_end": 2.8
  },
  "subtitles": {
    "style": {
      "font_family": "Manrope", "font_size": 58, "color": "#FFFFFF",
      "highlight_color": "#F2A93B", "position": "bottom"
    },
    "lines": [
      { "start": 0.0, "end": 2.8, "text": "Esto cambió mi forma de vender", "emphasis": true },
      { "start": 2.9, "end": 6.5, "text": "y no fue con más publicidad", "emphasis": false },
      { "start": 6.6, "end": 10.2, "text": "fue con un solo cambio en el guion", "emphasis": true },
      { "start": 10.3, "end": 15.0, "text": "te lo muestro paso a paso", "emphasis": false },
      { "start": 15.1, "end": 20.0, "text": "primero: dejé de hablar de mí", "emphasis": false },
      { "start": 20.1, "end": 25.0, "text": "y empecé a hablar del cliente", "emphasis": true },
      { "start": 25.1, "end": 31.0, "text": "eso solo triplicó las respuestas", "emphasis": true },
      { "start": 31.1, "end": 37.5, "text": "probalo en tu próximo reel", "emphasis": false }
    ]
  },
  "overlays": [
    { "id": "stat-x3", "type": "text", "text": "🔥 x3 respuestas", "start": 25.0, "end": 28.0, "position": { "x": 0.5, "y": 0.3 } }
  ],
  "zoom_keyframes": [
    { "t": 0, "scale": 1.0, "focus": "center" },
    { "t": 6, "scale": 1.08, "focus": "center" },
    { "t": 20, "scale": 1.0, "focus": "center" }
  ],
  "progress_bar": { "enabled": true, "color": "#F2A93B" },
  "branding": {
    "logo_url": "https://cdn.nexo-ia.cl/clients/3fa85f64-5717-4562-b3fc-2c963f66afa6/logo.png",
    "primary_color": "#1B2A4A", "accent_color": "#F2A93B",
    "handle": "@nexo.ia", "watermark_position": "bottom_right"
  },
  "end_card": { "enabled": true, "cta_text": "Seguime para más", "duration_sec": 2 },
  "music": { "track_id": "upbeat_soft_01", "volume_db": -18 },
  "meta": { "created_by": "llm_edit_director", "created_at": "2026-08-16T14:30:00Z", "version": 1 }
}
```

Fijate que `source_video.duration_sec` es 45 (el bruto), pero `duration.target_sec` es 38 (lo editado) — y que los `cuts` (0-45) y los `subtitles.lines`/`hook`/`overlays` (0-38) viven en dos líneas de tiempo distintas, como se explicó arriba.

---

## 3. Ejemplo de `edit_spec` inválido y explicación del error

Archivo: [`fabrica-reels/schema/examples/invalid-edit-spec.json`](./fabrica-reels/schema/examples/invalid-edit-spec.json). Es el mismo ejemplo con dos cambios deliberados, uno por cada capa de validación:

```diff
   "branding": {
     ...
-    "handle": "@nexo.ia",
+    "handle": "nexo.ia",
```

```diff
   "subtitles": { "lines": [
     { "start": 0.0, "end": 2.8, "text": "Esto cambió mi forma de vender", "emphasis": true },
     { "start": 2.9, "end": 6.5, "text": "y no fue con más publicidad", "emphasis": false },
-    { "start": 6.6, "end": 10.2, "text": "fue con un solo cambio en el guion", "emphasis": true }
+    { "start": 6.0, "end": 10.2, "text": "fue con un solo cambio en el guion", "emphasis": true }
```

Al correr `validateEditSpec(invalidSpec)`:

```
❌ edit_spec inválido:
  - [branding.handle] El handle debe empezar con @ y tener 2-30 caracteres
```

**Solo aparece ese error**, aunque el archivo tiene dos problemas — porque `validateEditSpec()` corta en la primera capa: si la validación **estructural** (Zod) falla, ni siquiera se llega a correr las reglas **semánticas**. Es una decisión de diseño a propósito: no tiene sentido gastar ciclos calculando solapes de subtítulos sobre un JSON que ni siquiera tiene la forma correcta.

Si se corrige el `handle` pero se deja el solape de subtítulos, la validación estructural pasa y ahí sí aparece el error semántico:

```
❌ edit_spec inválido:
  - [subtitles.lines[2]] El subtítulo "fue con un solo cambio en el guion" (empieza en 6s) se solapa con "y no fue con más publicidad" (termina en 6.5s)
```

Este es exactamente el tipo de error que un JSON Schema puro **no puede detectar** — depende de comparar el campo `end` de un elemento del array contra el `start` del siguiente. Por eso existe la capa semántica en TypeScript.

---

## 4. Validaciones obligatorias — dónde vive cada una

| Validación pedida | Capa | Dónde |
|---|---|---|
| Formato 9:16 | Estructural | `aspect_ratio: { "const": "9:16" }` + `canvas` fijo en 1080×1920 |
| Duración objetivo | Estructural + Semántica | `duration.target_sec` entre 5-90 (estructural) + suma de `cuts` conservados dentro de ±20% del objetivo (semántica) |
| Video source | Estructural | `source_video.url` (uri) + `duration_sec` requeridos |
| Timestamps válidos | Estructural | `start`/`end` ≥0 y `end > start` en cuts/captions/overlays/hook (refine de Zod) |
| Cortes sin solaparse | **Semántica** | `runSemanticChecks()` — no expresable en JSON Schema puro |
| Overlays con start/end | Estructural + Semántica | required en schema + verificación de que no excedan `duration.target_sec` y caigan en safe area |
| Subtítulos con estilo | Estructural | `subtitles.style` requerido (font, tamaño, colores, posición) |
| Branding por cliente | Estructural | `branding` requerido: logo, colores, handle con regex |
| Template seleccionado | Estructural | `template_id` enum cerrado (registro de templates existentes) |
| Plataforma destino | Estructural | `platform` enum `tiktok` \| `instagram_reels` |
| Safe areas TikTok/IG | **Semántica** | `safe-areas.ts` + chequeo de posición de subtítulos/overlays contra el perfil de la plataforma |

---

## 5-6. TypeScript types + `validateEditSpec()` con Zod

**Por qué Zod y no Ajv:** Remotion soporta nativamente definir el `schema` de una `<Composition />` con Zod (`Root.tsx`, sección 11) — eso habilita los controles editables de props en Remotion Studio gratis. Usar Zod acá evita mantener tres definiciones del mismo contrato (JSON Schema + interfaz TS a mano + validador Ajv): el tipo `EditSpec` se **genera** con `z.infer<typeof EditSpecSchema>`, no se escribe a mano ni diverge del validador.

Archivo: [`fabrica-reels/schema/edit-spec.zod.ts`](./fabrica-reels/schema/edit-spec.zod.ts)

```ts
import { z } from "zod";

export const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Debe ser un color hex de 6 dígitos");

const CutSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  keep: z.boolean(),
  reason: z.string().max(120).optional(),
}).refine((v) => v.end > v.start, { message: "end debe ser mayor que start", path: ["end"] });

const HookSchema = z.object({
  text: z.string().min(1).max(90),
  emphasis_words: z.array(z.string()).default([]),
  display_start: z.number().min(0),
  display_end: z.number().min(0),
}).refine((v) => v.display_end > v.display_start, { message: "display_end debe ser mayor que display_start", path: ["display_end"] });

// ... SubtitleStyleSchema, CaptionLineSchema, OverlaySchema, ZoomKeyframeSchema,
//     BrandingSchema con la misma lógica (ver archivo completo)

export const EditSpecSchema = z.object({
  schema_version: z.literal("1.0.0"),
  video_id: z.string().regex(/^VID-\d{4}-\d{2}-\d{2}-\d{3,}$/),
  client_id: z.string().uuid(),
  raw_video_id: z.string().uuid(),
  template_id: z.enum(["educativo_v1", "historia_v1", "venta_v1", "hook_fuerte_v1", "prueba_social_v1", "personal_brand_clean"]),
  platform: z.enum(["tiktok", "instagram_reels"]),
  aspect_ratio: z.literal("9:16"),
  canvas: z.object({ width: z.literal(1080), height: z.literal(1920) }).default({ width: 1080, height: 1920 }),
  source_video: z.object({ url: z.string().url(), duration_sec: z.number().positive().max(1800) }),
  duration: z.object({ target_sec: z.number().min(5).max(90) }),
  cuts: z.array(CutSchema).min(1),
  hook: HookSchema,
  subtitles: z.object({ style: SubtitleStyleSchema, lines: z.array(CaptionLineSchema).min(1) }),
  overlays: z.array(OverlaySchema).default([]),
  zoom_keyframes: z.array(ZoomKeyframeSchema).default([]),
  progress_bar: z.object({ enabled: z.boolean(), color: hexColor }).default({ enabled: true, color: "#F2A93B" }),
  branding: BrandingSchema,
  end_card: z.object({ enabled: z.boolean(), cta_text: z.string().max(60).optional(), duration_sec: z.number().min(1).max(4).optional() }).optional(),
  music: z.object({ track_id: z.string(), volume_db: z.number().min(-60).max(0) }).optional(),
  meta: z.object({
    created_by: z.enum(["llm_edit_director", "human_edit", "llm_repair"]),
    created_at: z.string().datetime(),
    version: z.number().int().min(1),
  }),
}).strict();

export type EditSpec = z.infer<typeof EditSpecSchema>;
```

(archivo completo, con todos los sub-schemas, en el repo).

`validateEditSpec()` — Archivo: [`fabrica-reels/validation/validateEditSpec.ts`](./fabrica-reels/validation/validateEditSpec.ts)

```ts
import { EditSpecSchema, type EditSpec } from "../schema/edit-spec.zod";
import { isWithinSafeArea, SUBTITLE_POSITION_Y, type Platform } from "../schema/safe-areas";

export type EditSpecValidationError = { path: string; message: string };
export type EditSpecValidationResult =
  | { valid: true; data: EditSpec }
  | { valid: false; errors: EditSpecValidationError[] };

const DURATION_TOLERANCE = 0.2;
const MAX_HOOK_START_SEC = 4;

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
  if (semanticErrors.length > 0) return { valid: false, errors: semanticErrors };
  return { valid: true, data: structural.data };
}

function runSemanticChecks(spec: EditSpec): EditSpecValidationError[] {
  const errors: EditSpecValidationError[] = [];
  const platform = spec.platform as Platform;

  // cuts: dentro del video fuente, sin solapes
  const sortedCuts = [...spec.cuts].sort((a, b) => a.start - b.start);
  sortedCuts.forEach((cut, i) => {
    if (cut.end > spec.source_video.duration_sec) {
      errors.push({ path: `cuts[${i}].end`, message: `El corte termina en ${cut.end}s pero el video fuente dura ${spec.source_video.duration_sec}s` });
    }
    const next = sortedCuts[i + 1];
    if (next && next.start < cut.end) {
      errors.push({ path: `cuts[${i + 1}].start`, message: `Se solapa con el corte anterior` });
    }
  });

  // duración conservada vs. objetivo (±20%)
  const keptDuration = spec.cuts.filter((c) => c.keep).reduce((acc, c) => acc + (c.end - c.start), 0);
  if (Math.abs(keptDuration - spec.duration.target_sec) > spec.duration.target_sec * DURATION_TOLERANCE) {
    errors.push({ path: "cuts", message: `La suma de cortes conservados (${keptDuration.toFixed(1)}s) se aleja demasiado de la duración objetivo (${spec.duration.target_sec}s)` });
  }

  // subtítulos: orden, sin solapes, dentro de la línea de tiempo final
  const sortedLines = [...spec.subtitles.lines].sort((a, b) => a.start - b.start);
  sortedLines.forEach((line, i) => {
    if (line.end > spec.duration.target_sec) {
      errors.push({ path: `subtitles.lines[${i}].end`, message: `El subtítulo "${line.text}" termina después del final del video` });
    }
    const next = sortedLines[i + 1];
    if (next && next.start < line.end) {
      errors.push({ path: `subtitles.lines[${i + 1}]`, message: `El subtítulo "${next.text}" se solapa con "${line.text}"` });
    }
  });

  // safe area de subtítulos y overlays
  const subtitleY = SUBTITLE_POSITION_Y[spec.subtitles.style.position];
  if (!isWithinSafeArea({ x: 0.5, y: subtitleY }, platform)) {
    errors.push({ path: "subtitles.style.position", message: `Cae fuera del área segura de ${platform}` });
  }
  spec.overlays.forEach((overlay, i) => {
    if (overlay.end > spec.duration.target_sec) {
      errors.push({ path: `overlays[${i}].end`, message: `El overlay "${overlay.id}" termina después del final del video` });
    }
    if (!isWithinSafeArea(overlay.position, platform)) {
      errors.push({ path: `overlays[${i}].position`, message: `El overlay "${overlay.id}" cae fuera del área segura de ${platform}` });
    }
  });

  // hook temprano
  if (spec.hook.display_start > MAX_HOOK_START_SEC) {
    errors.push({ path: "hook.display_start", message: `El hook debe aparecer dentro de los primeros ${MAX_HOOK_START_SEC}s` });
  }

  return errors;
}
```

*(versión completa, con los chequeos de `zoom_keyframes` y la regla propia del template `hook_fuerte_v1`, en el archivo real.)*

---

## 7. Cómo usar la validación antes de mandar el JSON a Remotion

**Regla:** nunca se llama a `renderEditSpec()` con un JSON que no pasó por `validateEditSpec()` primero — ni siquiera con datos que ya están guardados en Supabase (pudieron quedar de una versión vieja del schema, o alguien los tocó a mano).

El servicio de render (`fabrica-reels/remotion/src/render/renderService.ts`) es el punto de integración real que n8n llama por HTTP en la Capa 4:

```ts
app.post("/render", async (req, res) => {
  const { edit_spec_id } = req.body;
  const { data: row } = await supabase.from("edit_specs").select("id, spec_json").eq("id", edit_spec_id).single();

  const validation = validateEditSpec(row.spec_json);
  if (!validation.valid) {
    await supabase.from("edit_specs")
      .update({ validation_status: "invalid", validation_errors: validation.errors })
      .eq("id", edit_spec_id);
    return res.status(422).json({ error: "edit_spec inválido", details: validation.errors });
    // No se llega a gastar un render. n8n recibe el 422 y dispara el flujo
    // de reparación (sección 8) en vez de continuar a la Capa 5.
  }

  // ... crea la fila en `renders`, llama renderEditSpec(validation.data, outputLocation),
  // actualiza status a 'done' o 'failed'.
});
```

En n8n: el nodo que sigue al "Edit Director" (LLM) llama a `POST /render` con el `edit_spec_id`. Un `422` es una rama distinta del workflow (va a reparación), un `200` sigue a subir el archivo a Storage y avanzar el `status` del video a `rendered`.

---

## 8. Cómo manejar errores cuando el LLM genera un JSON inválido

No se reintenta indefinidamente ni se le pasa el problema a Remotion. El flujo es: **validar → si falla, pedirle al LLM que repare con los errores exactos → revalidar → máximo 3 vueltas → si sigue fallando, para y avisa a un humano.**

Archivo: [`fabrica-reels/validation/generateValidEditSpec.ts`](./fabrica-reels/validation/generateValidEditSpec.ts)

```ts
export async function generateValidEditSpec(
  callLlm: (system: string, user: string) => Promise<unknown>,
  firstAttemptJson: unknown
): Promise<GenerateValidEditSpecResult> {
  let current = firstAttemptJson;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const result = validateEditSpec(current);
    if (result.valid) return { ok: true, spec: result.data, attempts: attempt };
    if (attempt === MAX_REPAIR_ATTEMPTS) return { ok: false, lastErrors: result.errors, attempts: attempt };

    const { system, user } = buildRepairPrompt(current, result.errors);
    current = await callLlm(system, user);
  }
  return { ok: false, lastErrors: [], attempts: MAX_REPAIR_ATTEMPTS };
}
```

`callLlm` se inyecta a propósito — esta función no importa ningún SDK de Claude/OpenAI, así que corre igual desde un nodo Code de n8n que desde un microservicio propio.

Cuando devuelve `ok:false` después de 3 intentos, el workflow de n8n debe:
1. Marcar `edit_specs.status = 'failed_validation'` y guardar `lastErrors` en `validation_errors`.
2. Incrementar `repair_attempts`.
3. Mandar una alerta a Telegram/WhatsApp: *"El Edit Director no pudo generar un edit_spec válido para VID-2026-08-16-001 después de 3 intentos, revisar manualmente"*. Esto es intencional — es más barato que un humano mire 1 caso raro por semana a que el sistema renderice basura silenciosamente.

---

## 9. Prompt correctivo para reparar el JSON

Archivo: [`fabrica-reels/validation/repair-prompt.ts`](./fabrica-reels/validation/repair-prompt.ts)

```
SYSTEM:
Eres el Edit Director de la Fábrica de Reels de Nexo.IA.
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
- Respeta los enums cerrados (template_id, platform,
  subtitles.style.position, overlays[].type, branding.watermark_position).
- Responde solo con el JSON corregido, completo, sin texto adicional, sin
  markdown y sin explicación.

USER:
Errores encontrados (path + motivo):
{{errores_json}}

JSON original (inválido):
{{json_original}}
```

Nota clave: el prompt pide "corregí SOLO lo señalado", no "regenerá todo" — esto evita que el LLM, al reparar un error de `branding.handle`, aproveche y reescriba también los cortes que ya estaban bien.

---

## 10. Dónde guardar el `edit_spec` en Supabase

Extiende la tabla `edit_specs` (definida en `sistema-fabrica-reels-nexoia.md`, sección 9). Archivo: [`fabrica-reels/schema/edit-specs.migration.sql`](./fabrica-reels/schema/edit-specs.migration.sql)

```sql
alter table edit_specs
  add column if not exists schema_version text not null default '1.0.0',
  add column if not exists validation_status text not null default 'pending', -- pending | valid | invalid
  add column if not exists validation_errors jsonb,
  add column if not exists repair_attempts int not null default 0;

-- Columnas generadas desde el jsonb, para filtrar/indexar sin parsear en cada query
alter table edit_specs
  add column if not exists template_id text generated always as (spec_json ->> 'template_id') stored,
  add column if not exists platform text generated always as (spec_json ->> 'platform') stored;

create index if not exists idx_edit_specs_spec_json on edit_specs using gin (spec_json);
create index if not exists idx_edit_specs_raw_video on edit_specs (raw_video_id, version desc);
create index if not exists idx_edit_specs_template on edit_specs (template_id);

-- Defensa en profundidad opcional: Supabase soporta la extensión
-- pg_jsonschema para validar spec_json contra edit-spec.schema.json también
-- a nivel de Postgres (no reemplaza la validación semántica, que solo vive
-- en TypeScript, pero frena escrituras directas que salteen el flujo normal).
```

Reglas de retención: **nunca se borran versiones fallidas** — cada intento de reparación sube `version` en vez de pisar la fila. Es lo que permite calcular después "% de edit_specs aprobados en el primer intento" por template, la métrica que dice si un template necesita ajuste de prompt.

---

## 11-18. Composition Remotion `PersonalBrandClean`

Estructura completa en [`fabrica-reels/remotion/src/compositions/PersonalBrandClean/`](./fabrica-reels/remotion/src/compositions/PersonalBrandClean):

```
PersonalBrandClean.tsx    componente raíz de la composition
SubtitleLayer.tsx         subtítulos animados con highlight de énfasis
HookHeadline.tsx          hook grande arriba, palabra por palabra con énfasis
ProgressBar.tsx           barra de progreso superior
LogoWatermark.tsx         logo pequeño posicionable
EmphasisOverlay.tsx       overlays de texto/imagen puntuales
```

**Props tipadas directamente desde el `edit_spec`** — no hay una capa de mapeo intermedia: si el spec ya pasó `validateEditSpec()`, la Composition puede confiar en su forma.

```tsx
// PersonalBrandClean.tsx
import React, { useMemo } from "react";
import { AbsoluteFill, Easing, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditSpec } from "../../../../schema/edit-spec.zod";
import { SubtitleLayer } from "./SubtitleLayer";
import { HookHeadline } from "./HookHeadline";
import { ProgressBar } from "./ProgressBar";
import { LogoWatermark } from "./LogoWatermark";
import { EmphasisOverlay } from "./EmphasisOverlay";
import { secondsToFrames } from "../../utils/time";

export const PersonalBrandClean: React.FC<EditSpec> = (spec) => {
  const { fps, width, height } = useVideoConfig();
  const frame = useCurrentFrame();

  const zoomScale = useMemo(() => {
    if (spec.zoom_keyframes.length === 0) return 1;
    if (spec.zoom_keyframes.length === 1) return spec.zoom_keyframes[0].scale;
    const inputRange = spec.zoom_keyframes.map((kf) => secondsToFrames(kf.t, fps));
    const outputRange = spec.zoom_keyframes.map((kf) => kf.scale);
    return interpolate(frame, inputRange, outputRange, {
      extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad),
    });
  }, [frame, fps, spec.zoom_keyframes]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <AbsoluteFill style={{ transform: `scale(${zoomScale})`, transformOrigin: "center center" }}>
        <OffthreadVideo src={spec.source_video.url} />
      </AbsoluteFill>

      {spec.overlays.map((overlay) => (
        <EmphasisOverlay key={overlay.id} overlay={overlay} width={width} height={height} accentColor={spec.branding.accent_color} />
      ))}

      <Sequence
        from={secondsToFrames(spec.hook.display_start, fps)}
        durationInFrames={secondsToFrames(spec.hook.display_end - spec.hook.display_start, fps)}
        layout="none"
      >
        <HookHeadline hook={spec.hook} accentColor={spec.branding.accent_color} />
      </Sequence>

      <SubtitleLayer lines={spec.subtitles.lines} style={spec.subtitles.style} />

      {spec.progress_bar.enabled && <ProgressBar color={spec.progress_bar.color} />}

      <LogoWatermark logoUrl={spec.branding.logo_url} position={spec.branding.watermark_position} />
    </AbsoluteFill>
  );
};
```

Registro en `Root.tsx` — reutiliza el mismo `EditSpecSchema` de Zod como `schema` de la `<Composition />` (Remotion soporta esto nativamente y da controles editables gratis en Remotion Studio), y `calculateMetadata` calcula la duración en frames a partir de `duration.target_sec` del spec real, en vez de un valor fijo:

```tsx
// Root.tsx
<Composition
  id="PersonalBrandClean"
  component={PersonalBrandClean}
  schema={EditSpecSchema}
  fps={30}
  width={1080}
  height={1920}
  defaultProps={exampleSpec as EditSpec}
  calculateMetadata={async ({ props }) => ({
    durationInFrames: Math.round(props.duration.target_sec * 30),
    fps: 30, width: 1080, height: 1920,
  })}
/>
```

### Ejemplo de render local

```bash
cd fabrica-reels/remotion
npm install
npm run render:local
# → valida sample-data/example-edit-spec.json, y si es válido:
# 🎬 Renderizando VID-2026-08-16-001 (personal_brand_clean)...
# ✅ Render listo: fabrica-reels/remotion/out/VID-2026-08-16-001-instagram_reels.mp4
```

`renderLocal.ts` ([archivo](./fabrica-reels/remotion/src/render/renderLocal.ts)) es el script de referencia: valida con `validateEditSpec()`, y si falla, **no llama a Remotion** — imprime los errores y sale con código distinto de cero, para que se pueda usar en CI al agregar un template nuevo.

---

## Próximo paso natural

Con este contrato cerrado, agregar un template nuevo (`educativo_v1`, `venta_v1`, etc.) es: crear la carpeta de Composition, registrar el `id` en `Root.tsx`, y el `template_id` ya está aceptado por el schema desde el día 1 — no hay que tocar `edit-spec.schema.json` ni `edit-spec.zod.ts` para eso, solo si el template necesita un campo nuevo en el spec (ahí sí se sube `schema_version` a `1.1.0` y se actualizan ambos archivos del contrato juntos).
