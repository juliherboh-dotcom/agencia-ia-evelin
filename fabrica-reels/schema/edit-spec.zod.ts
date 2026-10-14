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

const ChecklistItemSchema = z.object({
  text: z.string().min(1).max(40),
  checked: z.boolean().default(true),
});

const OverlaySchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["text", "image", "badge", "notification", "checklist", "big_title"]),
    text: z.string().max(60).optional(),
    image_url: z.string().url().optional(),
    // Fracción del ancho del canvas (0-1), igual criterio que position.x/y.
    // Opcional: si no se manda, cada Composition usa su propio default --
    // nuevo en 1.2.0, agregado porque los overlays type:"image" reales
    // (mockups de UI, diagramas) son tarjetas grandes, no íconos chicos;
    // un solo ancho fijo por template no alcanza para todos los casos.
    width: z.number().min(0.05).max(0.95).optional(),
    // Campos de type:"notification" -- mockup de notificación de celular
    // (nuevo en 1.4.0, para representar visualmente lo que se dice, al
    // estilo del video de referencia de Evelin: mensajes, apps, etc.).
    notification_icon: z.string().max(4).optional(),
    notification_title: z.string().min(1).max(40).optional(),
    notification_subtitle: z.string().min(1).max(60).optional(),
    // Campos de type:"checklist" -- tarjeta con pasos/checks (nuevo en
    // 1.4.0, para listar un proceso tal como lo describe el audio).
    checklist_title: z.string().max(30).optional(),
    checklist_items: z.array(ChecklistItemSchema).min(1).max(6).optional(),
    // Campos de type:"big_title" -- texto grande bicolor sin tarjeta de
    // fondo (nuevo en 1.4.0), al estilo de los reels de referencia: una
    // palabra o frase corta en blanco y otra en el color de marca, encima
    // del video directamente (no es un pill con fondo como type:"text").
    title_line1: z.string().min(1).max(20).optional(),
    title_line2: z.string().min(1).max(20).optional(),
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
  })
  .refine((v) => v.type !== "notification" || !!v.notification_title, {
    message: "overlays de tipo 'notification' requieren 'notification_title'",
    path: ["notification_title"],
  })
  .refine((v) => v.type !== "checklist" || !!v.checklist_items, {
    message: "overlays de tipo 'checklist' requieren 'checklist_items'",
    path: ["checklist_items"],
  })
  .refine((v) => v.type !== "big_title" || !!v.title_line1, {
    message: "overlays de tipo 'big_title' requieren 'title_line1'",
    path: ["title_line1"],
  });

const CompareConfigSchema = z.object({
  enabled: z.boolean(),
  top_label: z.string().min(1).max(40),
  top_badge_text: z.string().max(60).optional(),
  bottom_label_prefix: z.string().min(1).max(40),
  bottom_label_highlight: z.string().min(1).max(40),
  bottom_label_accent_color: hexColor.optional(),
});

const SfxCueSchema = z.object({
  id: z.string().min(1),
  // URL directa del clip de sonido (mismo criterio que overlay.image_url y
  // branding.logo_url) -- a diferencia de music.track_id, que es una
  // referencia a una pista por nombre que hoy ningún render resuelve.
  sound_url: z.string().url(),
  // Timestamp en la línea de tiempo FINAL ya editada (segundos), igual
  // que hook/subtitles.lines/overlays/zoom_keyframes -- NO la del video
  // fuente.
  t: z.number().min(0),
  volume_db: z.number().min(-40).max(6).optional(),
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
    schema_version: z.enum(["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]),
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
    // Solo lo usa (y lo exige, vía validación semántica) template_id
    // "prueba_social_v1": layout split-screen antes/después. Campo nuevo
    // en 1.1.0 -- un edit_spec "1.0.0" sin `compare` sigue siendo válido
    // para el resto de los templates, que lo ignoran.
    compare: CompareConfigSchema.optional(),
    // Nuevo en 1.3.0. Son cues puntuales (un whoosh en un corte, un pop
    // al revelar un overlay), no una pista de fondo -- eso ya existe como
    // `music`, que es un campo aparte.
    sfx: z.array(SfxCueSchema).default([]),
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
export type CompareConfig = NonNullable<EditSpec["compare"]>;
export type SfxCue = EditSpec["sfx"][number];
