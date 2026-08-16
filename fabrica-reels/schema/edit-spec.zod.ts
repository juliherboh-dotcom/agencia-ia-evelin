/**
 * Fuente de verdad TypeScript del contrato EditSpec (Capa 3 -> Capa 4).
 *
 * Este archivo es funcionalmente equivalente a `edit-spec.schema.json` en la
 * misma carpeta. El JSON Schema es el contrato canónico y portable (se usa
 * para documentación, para embeber en el prompt del LLM y opcionalmente para
 * validar a nivel de Postgres con pg_jsonschema). Este schema de Zod es la
 * implementación de runtime para el mundo Node/TypeScript: valida el JSON en
 * tiempo real Y genera el tipo `EditSpec` con `z.infer`, así que nunca hay
 * que mantener una interfaz TS a mano por separado.
 *
 * Además, Remotion soporta nativamente `schema` con Zod en <Composition />
 * (ver src/Root.tsx): reutilizamos el mismo `EditSpecSchema` para eso, no
 * hay una tercera definición de tipos.
 *
 * Si cambiás una regla acá, replicá el cambio en edit-spec.schema.json (y
 * viceversa) y subí `schema_version`.
 */
import { z } from "zod";

export const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Debe ser un color hex de 6 dígitos, ej. #1B2A4A");

export const PositionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const CutSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().min(0),
    keep: z.boolean(),
    reason: z.string().max(120).optional(),
  })
  .refine((v) => v.end > v.start, {
    message: "end debe ser mayor que start",
    path: ["end"],
  });

const HookSchema = z
  .object({
    text: z.string().min(1).max(90),
    emphasis_words: z.array(z.string()).default([]),
    display_start: z.number().min(0),
    display_end: z.number().min(0),
  })
  .refine((v) => v.display_end > v.display_start, {
    message: "display_end debe ser mayor que display_start",
    path: ["display_end"],
  });

const SubtitleStyleSchema = z.object({
  font_family: z.string().min(1),
  font_size: z.number().int().min(28).max(96),
  color: hexColor,
  highlight_color: hexColor,
  position: z.enum(["top", "center", "bottom"]),
});

const CaptionLineSchema = z
  .object({
    start: z.number().min(0),
    end: z.number().min(0),
    text: z.string().min(1).max(80),
    emphasis: z.boolean().default(false),
  })
  .refine((v) => v.end > v.start, {
    message: "end debe ser mayor que start",
    path: ["end"],
  });

const OverlaySchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["text", "image", "badge"]),
    text: z.string().max(60).optional(),
    image_url: z.string().url().optional(),
    start: z.number().min(0),
    end: z.number().min(0),
    position: PositionSchema,
  })
  .refine((v) => v.end > v.start, {
    message: "end debe ser mayor que start",
    path: ["end"],
  })
  .refine((v) => v.type !== "text" || !!v.text, {
    message: "overlays de tipo 'text' requieren 'text'",
    path: ["text"],
  })
  .refine((v) => v.type !== "image" || !!v.image_url, {
    message: "overlays de tipo 'image' requieren 'image_url'",
    path: ["image_url"],
  });

const ZoomKeyframeSchema = z.object({
  t: z.number().min(0),
  scale: z.number().min(1.0).max(1.6),
  focus: z.enum(["center", "top", "bottom"]).default("center"),
});

const BrandingSchema = z.object({
  logo_url: z.string().url(),
  primary_color: hexColor,
  accent_color: hexColor,
  handle: z
    .string()
    .regex(/^@[a-zA-Z0-9._]{2,30}$/, "El handle debe empezar con @ y tener 2-30 caracteres"),
  watermark_position: z
    .enum(["top_left", "top_right", "bottom_left", "bottom_right"])
    .default("bottom_right"),
});

export const EditSpecSchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    video_id: z.string().regex(/^VID-\d{4}-\d{2}-\d{2}-\d{3,}$/),
    client_id: z.string().uuid(),
    raw_video_id: z.string().uuid(),
    template_id: z.enum([
      "educativo_v1",
      "historia_v1",
      "venta_v1",
      "hook_fuerte_v1",
      "prueba_social_v1",
      "personal_brand_clean",
    ]),
    platform: z.enum(["tiktok", "instagram_reels"]),
    aspect_ratio: z.literal("9:16"),
    canvas: z
      .object({ width: z.literal(1080), height: z.literal(1920) })
      .default({ width: 1080, height: 1920 }),
    source_video: z.object({
      url: z.string().url(),
      duration_sec: z.number().positive().max(1800),
    }),
    duration: z.object({
      target_sec: z.number().min(5).max(90),
    }),
    cuts: z.array(CutSchema).min(1),
    hook: HookSchema,
    subtitles: z.object({
      style: SubtitleStyleSchema,
      lines: z.array(CaptionLineSchema).min(1),
    }),
    overlays: z.array(OverlaySchema).default([]),
    zoom_keyframes: z.array(ZoomKeyframeSchema).default([]),
    progress_bar: z
      .object({ enabled: z.boolean(), color: hexColor })
      .default({ enabled: true, color: "#F2A93B" }),
    branding: BrandingSchema,
    end_card: z
      .object({
        enabled: z.boolean(),
        cta_text: z.string().max(60).optional(),
        duration_sec: z.number().min(1).max(4).optional(),
      })
      .optional(),
    music: z
      .object({
        track_id: z.string(),
        volume_db: z.number().min(-60).max(0),
      })
      .optional(),
    meta: z.object({
      created_by: z.enum(["llm_edit_director", "human_edit", "llm_repair"]),
      created_at: z.string().datetime(),
      version: z.number().int().min(1),
    }),
  })
  .strict();

export type EditSpec = z.infer<typeof EditSpecSchema>;
export type Cut = EditSpec["cuts"][number];
export type CaptionLine = EditSpec["subtitles"]["lines"][number];
export type Overlay = EditSpec["overlays"][number];
export type ZoomKeyframe = EditSpec["zoom_keyframes"][number];
