# Fábrica Automatizada de Reels — Arquitectura final (Nexo.IA)

**Premisa:** "Tú grabas. El sistema edita, publica, mide, aprende y genera nuevas ideas."
**Enfoque:** arquitectura final diseñada de una vez (multi-cliente, sin deuda técnica), **implementada por capas**. Ninguna capa posterior obliga a rehacer el modelo de datos ni el orquestador de una capa anterior.
**Relación con el documento previo:** `sistema-piloto-reels.md` era el MVP de validación (Airtable + edición manual). Este documento lo reemplaza como plan de construcción: mismo espíritu, pero con motor de edición automática (Remotion), base de datos multi-tenant desde el día 1, y diseño explícito para venderse como servicio de agencia.

---

## Parte I — Arquitectura

### 1. Arquitectura completa del sistema (11 capas)

```
CAPA 0  Infra & Datos          → Supabase (Postgres+Storage+Auth) + n8n self-hosted
CAPA 1  Ingesta                → Drive/Upload → Storage canónico
CAPA 2  Transcripción+Análisis → Whisper + Claude/GPT
CAPA 3  Dirección de edición   → LLM genera el JSON de edición (edit spec)
CAPA 4  Render automático      → Remotion (render farm)
CAPA 5  Revisión humana        → Aprobar / Rechazar / Pedir cambios
CAPA 6  Publicación            → Publisher API (Ayrshare/Upload-Post/Metricool/Publer)
CAPA 7  Métricas               → Pull 24h/48h/72h/7d
CAPA 8  Scoring & Ganadores    → Fórmula 0-100
CAPA 9  Motor de variantes     → Guiones nuevos + re-cortes automáticos
CAPA 10 Reporting & Alertas    → Semanal, por cliente
CAPA 11 Multi-tenant/Agencia   → Onboarding, billing, aislamiento de datos
```

Cada capa expone su resultado como una fila con `status` en Postgres. **n8n no guarda estado propio** — es orquestador puro, lee/escribe en Supabase y llama servicios (LLM, Remotion, Publisher). Esto es la decisión de diseño más importante del sistema: si n8n se cae o se reemplaza en el futuro, el estado de la fábrica sobrevive porque vive en la base de datos, no en la memoria de los workflows.

### 2. Diagrama de flujo (pipeline completo)

```
 [Creador graba]
        │
        ▼
 ┌──────────────┐
 │ 1. INGESTA   │  Drive/Upload → Supabase Storage (raw_videos)
 └──────┬───────┘
        ▼
 ┌──────────────┐
 │ 2. TRANSCRIBE│  Whisper → texto + timestamps por palabra
 └──────┬───────┘
        ▼
 ┌──────────────┐
 │ 3. ANALIZA   │  Claude/GPT → tema, categoría, hook_score, score_calidad
 └──────┬───────┘
        ▼
 ┌──────────────┐
 │ 4. ASSETS    │  Claude/GPT → captions, hashtags, hooks alternativos
 └──────┬───────┘
        ▼
 ┌───────────────────┐
 │ 5. EDIT DIRECTOR   │  LLM → JSON de edición (cortes, subtítulos, zoom, template)
 └──────┬─────────────┘
        ▼
 ┌──────────────┐
 │ 6. RENDER     │  Remotion (self-host o Lambda) → MP4 final 9:16
 └──────┬───────┘
        ▼
 ┌──────────────┐        rechazado con comentario
 │ 7. REVISIÓN   │ ─────────────────┐
 │ humana        │                  │
 └──────┬───────┘                  ▼
        │ aprobado          vuelve a CAPA 5 (nuevo edit spec)
        ▼
 ┌──────────────┐
 │ 8. PUBLICA    │  Publisher API → IG Reels + TikTok
 └──────┬───────┘
        ▼
 ┌────────────────────────────┐
 │ 9. MÉTRICAS 24/48/72h/7d    │
 └──────┬─────────────────────┘
        ▼
 ┌──────────────┐
 │ 10. SCORING   │  0-100 vs. benchmark de cuenta
 └──────┬───────┘
        │
        ├── score ≥70 ──▶ ┌────────────────────────┐
        │                 │ 11. MOTOR DE VARIANTES  │
        │                 │  Tipo A: nuevo guion    │──▶ cola "por grabar" ──▶ vuelve a CAPA 1
        │                 │  Tipo B: re-corte auto  │──▶ nuevo edit spec  ──▶ vuelve a CAPA 6 (sin grabar de nuevo)
        │                 └────────────────────────┘
        ▼
 ┌──────────────┐
 │ 12. REPORTE   │  Semanal, por cliente, con alertas WhatsApp/Telegram
 │ semanal       │
 └──────────────┘
```

El detalle que hace esto una "fábrica" y no un pipeline lineal: **el ciclo cierra en dos puntos**, no uno. Un ganador puede generar (A) un guion nuevo que exige volver a grabar, o (B) un re-corte del mismo bruto con otro hook/caption que **se renderiza automáticamente sin que el creador toque la cámara**. El tipo B es la palanca de escala real del sistema — más adelante se explica cómo se decide cuál aplica.

### 3. Stack recomendado (final, no de transición)

| Capa | Herramienta | Por qué |
|---|---|---|
| Base de datos | **Supabase (Postgres)** | Multi-tenant real desde el día 1 (RLS), Storage integrado para video, Auth para el portal de clientes, escalable sin migración futura |
| Orquestador | **n8n self-hosted** (Docker en VPS o Fly.io/Railway) | Control total de ejecución larga (renders tardan minutos), sin límite de "operaciones" de un plan cloud, community nodes para HTTP/Postgres/Supabase |
| Transcripción | **OpenAI Whisper API** (`gpt-4o-transcribe` o `whisper-1`) | Timestamps por palabra, buena precisión en español |
| Análisis + generación de texto | **Claude (Sonnet)** vía API | Mejor seguimiento de instrucciones de formato JSON estricto y prompts largos con contexto de marca |
| Edición automática | **Remotion** (self-hosted render server, migrable a Remotion Lambda) | Único framework que permite "editar por código": video = función de un JSON de props. Es la pieza que reemplaza la edición manual del MVP |
| Publicación | **Ayrshare o Upload-Post** (API-first, multi-cuenta, pensado para automatización) con **Metricool/Publer** como alternativa de arranque más simple | Ver sección 8 |
| Alertas | **Telegram Bot API** + WhatsApp Cloud API (Meta) para clientes que ya usan WhatsApp como canal | |
| Portal de revisión/cliente | **Next.js + Supabase Auth** (Capa 11) | Reemplaza el "Airtable Interface" del MVP cuando hay múltiples clientes con login propio |

### 4. Qué hace n8n

Orquestador puro y "pegamento" entre servicios. Responsabilidades exactas:
- Triggers: Drive/Upload webhook, Cron (schedules de métricas y reportes), Webhooks entrantes (callback de Remotion cuando termina un render, callback de aprobación/rechazo desde el portal o Telegram).
- Llamadas HTTP a: Whisper, Claude, servicio de render Remotion, Publisher API, Telegram/WhatsApp.
- Lectura/escritura en Supabase vía nodo Postgres/Supabase (nunca guarda datos de negocio en su propia memoria).
- Lógica de ruteo por `status`: cada workflow empieza con un query "dame las filas en estado X" y termina actualizando esa fila a estado X+1 (o a un estado de error con reintento).
- **Lo que n8n NO hace:** no renderiza video, no decide el score (eso es una función SQL/Edge Function para que sea auditable y no dependa de que un workflow no se haya caído), no es la fuente de verdad del estado del cliente (eso vive en `clients`/`social_accounts` en Supabase).

### 5. Qué hace Supabase (reemplaza a Airtable como sistema de verdad)

- **Postgres**: todas las tablas de la sección 9, con `client_id` en cada una y Row Level Security activada desde el día 1 (aunque al principio haya un solo cliente).
- **Storage**: buckets `raw/`, `renders/`, `assets/` (thumbnails, logos de marca por cliente).
- **Auth**: usuarios del portal de revisión (equipo de agencia + cada cliente ve solo lo suyo).
- **Edge Functions**: cálculo de `score_rendimiento` (función determinística, no un prompt — ver sección 17) y validación de esquema del JSON de edición antes de mandarlo a Remotion.
- **Airtable no desaparece del todo**: se puede dejar como **vista de conveniencia** sincronizada uni-direccionalmente (Supabase → Airtable vía n8n) para uso interno del equipo no técnico de la agencia, pero nunca es la fuente de verdad ni recibe escrituras directas. Si el equipo es 100% cómodo en un portal propio, se puede omitir directamente.

### 6. Qué hace OpenAI/Claude

Tres roles distintos, tres prompts distintos (no un prompt gigante que hace todo):
1. **Transcripción** (Whisper — no es un LLM de chat, es el modelo de speech-to-text).
2. **Analista + Copywriter** (Claude): clasifica, da scores, genera captions/hooks/hashtags — igual que en el MVP.
3. **Edit Director** (Claude, prompt nuevo — sección 11): el rol que no existía en el MVP. Convierte transcripción + timestamps + categoría en el **JSON de edición** que Remotion consume. Este es el prompt que reemplaza el criterio del editor humano.

### 7. Qué hace Remotion

Remotion es un framework que renderiza video **desde componentes React**, recibiendo datos como props (no como timeline arrastrado a mano). Reemplaza CapCut/VEED del MVP en el 90% de los casos.

- Cada "estilo" de video (educativo, historia personal, venta, etc.) es una **Composition** de Remotion: un componente React que sabe dibujar subtítulos animados, aplicar zoom/crop, poner marca de agua, intro/outro.
- El **input** de cada render es el video fuente + el JSON de edición (sección 11).
- El **output** es un MP4 9:16 renderizado por Chromium headless, subido a Supabase Storage.
- Corre como un **servicio propio** (no un nodo nativo de n8n): un pequeño servidor Node/Express (`POST /render`) que n8n llama por HTTP, o Remotion Lambda (AWS) cuando el volumen de renders concurrentes lo justifique.
- Lo que Remotion **no** decide: qué cortar, dónde poner énfasis, qué template usar — eso lo decide el LLM en la Capa 3 (Edit Director) y se lo pasa como datos. Remotion es "el brazo", no "el criterio".

### 8. Qué hace la capa de publicación

| Opción | Naturaleza | Por qué entra o no en la arquitectura final |
|---|---|---|
| **Ayrshare** | API-first, pensada para apps que publican en nombre de múltiples cuentas de clientes (exactamente el caso de una agencia) | **Recomendado para el sistema final**: onboarding de cuenta de cliente vía link OAuth propio, un solo endpoint para publicar en IG+TikTok+más, webhooks de estado |
| **Upload-Post** | Similar a Ayrshare, más simple y barata, buena opción si el volumen de clientes es chico-mediano | Alternativa directa a Ayrshare, comparar precio según volumen real |
| **Metricool / Publer** | Dashboard-first con API secundaria | Válidas para arrancar (así lo usa el MVP) pero **no fueron diseñadas para multi-cliente programático** — sirven mientras el sistema tiene 1-3 cuentas; migran a Ayrshare/Upload-Post en Capa 11 |
| **API directa Meta + TikTok** | Máximo control, cero intermediario | Solo se justifica a escala grande (10+ clientes) donde el costo de mantener el review de apps y tokens compensa el ahorro |

**Decisión para este proyecto:** arrancar con Metricool o Publer (ya validado en el MVP) y dejar la capa de publicación **abstraída detrás de una tabla `social_accounts.publisher_provider`**, de forma que migrar a Ayrshare en la Capa 11 sea cambiar un valor de configuración y un nodo HTTP en n8n, no rediseñar el flujo.

---

## Parte II — Especificación técnica

### 9. Estructura de base de datos (Supabase / Postgres, multi-tenant desde el día 1)

```sql
-- Tenant raíz
clients (
  id uuid pk, name text, niche text, brand_tone text,
  plan text,              -- starter | pro | agency
  status text,            -- active | paused | churned
  created_at timestamptz
)

brand_kit (
  id uuid pk, client_id uuid fk,
  logo_url text, primary_color text, accent_color text, font text,
  handle_instagram text, handle_tiktok text, end_card_cta text
)

social_accounts (
  id uuid pk, client_id uuid fk,
  platform text,                -- instagram | tiktok
  publisher_provider text,      -- metricool | publer | ayrshare | direct_api
  external_account_id text, oauth_token_ref text,  -- referencia a secret manager, nunca el token en texto plano
  status text, connected_at timestamptz
)

raw_videos (
  id uuid pk, client_id uuid fk,
  filename text, storage_path text, duration_sec numeric,
  status text,                   -- ver sección 10 (state machine)
  parent_video_id uuid null fk -> raw_videos,  -- variantes tipo B (re-corte del mismo bruto)
  uploaded_at timestamptz
)

transcripts (
  id uuid pk, raw_video_id uuid fk,
  text_full text, words jsonb,   -- [{word, start, end}, ...]
  language text, created_at timestamptz
)

analyses (
  id uuid pk, raw_video_id uuid fk,
  tema text, categoria text, hook_principal text,
  hook_score int, score_calidad int, descripcion_objetivo text,
  raw_llm_response jsonb, created_at timestamptz
)

assets (
  id uuid pk, raw_video_id uuid fk,
  titulos jsonb, captions_ig jsonb, captions_tiktok jsonb,
  hashtags jsonb, hooks_alternativos jsonb, recomendacion_edicion text
)

edit_specs (
  id uuid pk, raw_video_id uuid fk,
  template_id text, spec_json jsonb, version int,
  status text,                   -- draft | ready | rejected_feedback
  feedback text null, created_at timestamptz
)

renders (
  id uuid pk, edit_spec_id uuid fk,
  platform_variant text,         -- tiktok | instagram (ajustes de duración/aspecto)
  storage_path text, render_engine text,  -- remotion_local | remotion_lambda
  render_time_sec numeric, status text,   -- queued | rendering | done | failed
  created_at timestamptz
)

review_actions (
  id uuid pk, render_id uuid fk,
  reviewer text, decision text,  -- approved | rejected | edit_requested
  comment text, decided_at timestamptz
)

publications (
  id uuid pk, render_id uuid fk, client_id uuid fk,
  platform text, scheduled_at timestamptz, published_at timestamptz,
  external_post_id text, status text,
  caption_used text, hashtags_used text
)

metrics (
  id uuid pk, publication_id uuid fk,
  window text,                   -- 24h | 48h | 72h | 7d
  measured_at timestamptz,
  views int, likes int, comments int, shares int, saves int,
  followers_gained int, retention_avg numeric,
  source text                    -- api | manual
)

benchmarks (
  id uuid pk, client_id uuid fk, period text,   -- rolling_30d
  avg_views numeric, avg_engagement_rate numeric, updated_at timestamptz
)

scores (
  id uuid pk, publication_id uuid fk,
  score_rendimiento numeric, classification text,  -- ganador | prometedor | promedio | bajo
  computed_at timestamptz
)

scripts (
  id uuid pk, client_id uuid fk,
  parent_publication_id uuid fk null,
  variant_type text,              -- A_requiere_grabacion | B_re_corte_automatico
  idea text, hook text, guion text, angulo text,
  status text,                    -- pendiente_grabacion | pendiente_render | descartado
  created_at timestamptz
)

reports (
  id uuid pk, client_id uuid fk,
  period_start date, period_end date, content_md text, sent_at timestamptz
)

cost_ledger (
  id uuid pk, client_id uuid fk,
  item text,                      -- whisper | llm | render | publisher_api
  amount_usd numeric, incurred_at timestamptz
)
```

**Por qué esta forma y no una tabla gigante `videos`:** cada capa escribe en su propia tabla y solo lee de la anterior. Esto es lo que permite implementar por capas de verdad — la Capa 4 (Render) se puede construir y probar con datos de `edit_specs` sin que exista todavía la Capa 6 (Publicación). También es lo que hace auditable el sistema para venderlo: se le puede mostrar a un cliente exactamente en qué paso está cada video y por qué se rechazó un render (columna `feedback` en `edit_specs`).

`cost_ledger` existe desde el día 1 aunque no se use activamente hasta la Capa 11 — es la tabla que permite, más adelante, saber el margen real por cliente sin tener que instrumentar todo de nuevo.

### 10. Estados del flujo de producción (máquina de estados de `raw_videos` + relacionadas)

```
raw_uploaded
   → transcribing → transcribed
   → analyzing → analyzed
   → generating_assets → assets_ready
   → generating_edit_spec → edit_spec_ready
   → rendering → rendered
   → pending_review
       → approved → scheduled → publishing → published
       → rejected → generating_edit_spec (vuelve con feedback, nueva version en edit_specs)
       → discarded (fin del camino, sin publicar)
   → measuring_24h → measuring_48h → measuring_72h → measuring_7d
   → scored
       → winner → variant_generating → (scripts: tipo A o tipo B)
       → archived
```

Reglas de transición importantes:
- **Nunca se sobrescribe una fila anterior**: un rechazo crea una nueva versión en `edit_specs` (campo `version`), no borra la anterior — así se puede auditar cuántos intentos tomó aprobar un video (métrica interna de calidad del Edit Director).
- **Cualquier estado puede caer en `failed_<capa>`** con reintento automático (máx. 3) antes de escalar como alerta a un humano — esto se explica en Riesgos técnicos (sección 24).

### 11. JSON de edición para Remotion (el contrato entre IA y render)

Este JSON lo genera el **Edit Director** (Claude) a partir de la transcripción con timestamps por palabra + la categoría/hook detectados. Es el artefacto central del sistema.

```json
{
  "video_id": "VID-2026-08-16-001",
  "template_id": "educativo_v1",
  "source_video_url": "https://.../raw/VID-2026-08-16-001.mp4",
  "aspect_ratio": "9:16",
  "duration_estimate_sec": 38.5,
  "cuts": [
    {"start": 0.0, "end": 8.4, "keep": true},
    {"start": 8.4, "end": 11.0, "keep": false, "reason": "muletilla/silencio"},
    {"start": 11.0, "end": 33.2, "keep": true}
  ],
  "captions": [
    {"start": 0.0, "end": 1.1, "text": "Esto cambió todo", "emphasis": true},
    {"start": 1.1, "end": 3.4, "text": "para mi negocio", "emphasis": false}
  ],
  "zoom_keyframes": [
    {"t": 0.0, "scale": 1.0},
    {"t": 3.2, "scale": 1.15, "focus": "center"}
  ],
  "branding": {
    "logo_url": "https://.../brand/nexoia-logo.png",
    "primary_color": "#1B2A4A",
    "accent_color": "#F2A93B",
    "handle": "@nexo.ia"
  },
  "end_card": {
    "enabled": true,
    "cta_text": "Seguime para más",
    "duration_sec": 2
  },
  "music": {"track_id": "upbeat_01", "volume_db": -18},
  "platform_variant": "tiktok"
}
```

**Reglas para el LLM al generar `cuts`:** eliminar silencios >1.5s y muletillas evidentes, pero nunca cortar dentro de una idea (usar los timestamps por palabra de Whisper para no cortar mitad de frase). **Reglas para `captions`:** agrupar en chunks de 3-6 palabras (no palabra por palabra, que se lee mal), marcar `emphasis:true` en la palabra/frase que es la promesa del hook. Este JSON se valida contra un schema (Edge Function de Supabase) antes de mandarse a Remotion — si el LLM devuelve algo mal formado, la fila queda en `edit_spec_ready=false` con el error, sin gastar un render.

### 12. Plantillas Remotion necesarias (Compositions)

Componentes compartidos (se reutilizan entre templates):
- `<SubtitleLayer>` — renderiza `captions[]` con animación de entrada palabra/frase y highlight de `emphasis`.
- `<ZoomPanLayer>` — aplica `zoom_keyframes[]` sobre el video fuente.
- `<BrandWatermark>` — logo + handle, posición configurable por `branding`.
- `<EndCard>` — tarjeta de cierre con CTA.
- `<IntroBumper>` — opcional, 0.5-1s de marca al inicio.

Templates (Compositions) mínimas para cubrir las 7 categorías de contenido:

| Template | Categoría | Rasgos visuales |
|---|---|---|
| `educativo_v1` | educativo, autoridad | Subtítulos grandes centrados, highlight de palabra clave, sin end card agresivo |
| `historia_v1` | historia personal | Subtítulos más chicos abajo, transición suave, sin CTA fuerte |
| `venta_v1` | venta | End card con oferta/precio, watermark permanente, highlight en palabras de urgencia |
| `hook_fuerte_v1` | polémico, tendencia | Freeze-frame + zoom dramático en el primer segundo con el hook en texto grande |
| `prueba_social_v1` | prueba social | Caption tipo "quote box", posible layout split-screen antes/después |

Cada template es un componente React de ~100-150 líneas que recibe el JSON de la sección 11 como `inputProps`. Construir estos 5 templates es **la Capa 4** — no se necesitan más de 5 para cubrir el 100% de las categorías definidas en el análisis (sección 6 del MVP original).

### 13. Cómo renderizar variantes

Dos caminos, y la diferencia es la que determina si hace falta volver a grabar:

- **Variante Tipo A — "nuevo guion"**: el motor de variantes (sección 18) genera un guion distinto (otro ejemplo, otro caso, otro ángulo). No hay video fuente todavía → la fila entra en `scripts` con `status=pendiente_grabacion`, aparece en la cola del creador, y **cuando se graba, reingresa por Capa 1 como un `raw_video` normal**, con `parent_video_id` apuntando al video ganador que la originó (para trazabilidad de "de qué patrón viene").
- **Variante Tipo B — "re-corte automático"**: se reutiliza el `source_video_url` del video ganador (o de brutos relacionados no publicados), y el Edit Director genera un **nuevo `edit_spec`** con otro hook (de `hooks_alternativos`), otro orden de cortes o otro template — **sin intervención humana de grabación**. Va directo de `scripts (tipo B)` a Capa 3 (nuevo edit spec) → Capa 4 (render) → Capa 5 (revisión). Esta es la variante que hace que "un video ganador" se convierta en 3-4 publicaciones sin esfuerzo adicional del creador, y es el diferencial real de tener Remotion en el sistema.

Regla práctica: el motor de variantes genera primero 2-3 ideas Tipo B (rápidas, gratis de "grabación") y luego 5-7 ideas Tipo A (para el próximo lote de grabación), priorizando así lo que no cuesta tiempo de cámara.

### 14. Cómo implementar la aprobación humana

Dos niveles, construidos en capas distintas (no rehacer):

- **Capa 5 inicial (rápida de construir):** n8n manda el render a Telegram (o WhatsApp) con el video adjunto y **botones inline** "✅ Aprobar" / "✍️ Pedir cambios". El callback del botón pega a un webhook de n8n que actualiza `review_actions` y dispara el siguiente paso. Si es "Pedir cambios", pide como respuesta un texto libre que se guarda en `edit_specs.feedback` y regenera el edit spec incorporando ese feedback como instrucción adicional al Edit Director.
- **Capa 11 (portal propio, cuando hay varios clientes):** mini web Next.js + Supabase Auth donde cada cliente ve su cola `pending_review`, reproduce el video, aprueba/rechaza con comentario. Mismo webhook de destino (`review_actions`) — el cambio es solo la interfaz, no el modelo de datos ni el flujo de n8n. Esto es exactamente el motivo de diseñar `review_actions` como tabla independiente desde el día 1: la fuente (Telegram vs. portal web) es un detalle de UI, no de arquitectura.

### 15. Cómo conectar publicación

1. Onboarding de cuenta de cliente: conecta IG Business + TikTok Creator vía el flujo OAuth del proveedor elegido (Metricool/Publer al inicio, Ayrshare en escala) → se guarda en `social_accounts`.
2. n8n, al ver `status=approved` + `scheduled_at` cumplido, llama al endpoint de publicación del proveedor con: video (`storage_path` del render), caption (de `assets`, editable en la revisión), hashtags, plataforma.
3. Respuesta del proveedor → `publications.external_post_id` + `status=published`.
4. Horario de publicación: se calcula por `benchmarks` (mejor horario histórico de la cuenta) o, si no hay histórico suficiente, se usa un horario por defecto de la categoría (educativo → mañana, entretenimiento/polémico → noche) configurable por cliente en `brand_kit`/config.

### 16. Cómo medir métricas

Igual que en el MVP (Schedule Trigger cada 6h, ventanas 24/48/72h/7d, tabla `metrics` sin pisar datos), con dos cambios para la arquitectura final:
- El *pull* de métricas es multi-cliente: el workflow itera sobre todas las `publications` pendientes de medición de todos los clientes activos, no de una sola cuenta.
- **Fallback manual** (guardados de TikTok, retención no expuesta) se resuelve en la Capa 11 con un mini-formulario en el portal del cliente/equipo de agencia en vez de un Airtable Form — mismo concepto, mismo destino (tabla `metrics`, `source=manual`).

### 17. Fórmula de scoring (Score de Rendimiento 0-100)

Se implementa como **función SQL/Edge Function determinística**, no como prompt — para que sea auditable, barata y reproducible.

```
Score_Rendimiento =
    (Views_Index      × 30) +
    (Compartidos_Index × 20) +
    (Guardados_Index   × 20) +
    (Comentarios_Index × 15) +
    (Retención_Index   × 10) +
    (Seguidores_Index  × 5)

*_Index = LEAST( (metrica_video / metrica_promedio_cuenta) / 2 , 1 )
```

Si `Retención_Index` no está disponible (fallback manual pendiente), sus 10 puntos se redistribuyen proporcionalmente entre Guardados y Compartidos. Clasificación: **80-100 ganador claro** (dispara motor de variantes automáticamente) · **60-79 prometedor** (revisión manual) · **40-59 promedio** · **<40 bajo rendimiento** (descarta el ángulo, conserva el tema).

### 18. Motor de variantes

Mismo prompt base que el MVP (ver `sistema-piloto-reels.md` sección 9), con dos cambios para la arquitectura final:
1. El prompt ahora debe **clasificar cada idea generada como Tipo A o Tipo B** (sección 13), para que el sistema sepa si puede renderizar directo o necesita ir a la cola de grabación.
2. El output se guarda en la tabla `scripts` (no en una tabla aparte "Variantes_Generadas" suelta), con `parent_publication_id` para trazabilidad completa: se puede reconstruir el árbol genealógico de "de qué video original viene cada variante" — dato valioso para el reporte semanal y para venderle al cliente el argumento de "no adivinamos, replicamos lo que ya funcionó".

### 19. Reporte semanal

Igual estructura de contenido que el MVP (top 3, bottom 3, temas ganadores, qué grabar, calendario sugerido), con el cambio de que ahora es **por cliente** (`reports.client_id`) y se genera en batch los domingos para todos los clientes activos. Se agrega una sección nueva posible gracias al árbol de variantes: *"de las 6 variantes generadas la semana pasada, 4 fueron Tipo B (cero tiempo de grabación) y ya están publicadas"* — es un dato que demuestra apalancamiento del sistema, útil también como contenido de venta.

---

## Parte III — Ejecución y negocio

### 20-21-22. Roadmap por capas, orden exacto y qué construir primero (para cero retrabajo)

El orden **no** es "MVP chico y después arquitectura grande". Es: **diseñar el modelo de datos final primero, y construir sobre él en vertical, una capa a la vez.**

```
CAPA 0 — Fundación (semana 1)
  → Crear TODAS las tablas de la sección 9 en Supabase (aunque varias queden vacías meses).
  → RLS activado desde el día 1, con client_id fijo = "nexo-ia-interno" (tu propia marca) como primer tenant.
  → n8n self-hosted levantado (Docker), credenciales base conectadas.
  Por qué primero: cambiar el esquema después de tener datos reales cargados es lo único
  que realmente genera retrabajo caro. Esto se diseña una vez y no se vuelve a tocar.

CAPA 1 — Ingesta (semana 1-2)
  → Drive/Upload → Storage, fila en raw_videos con client_id.
  → Probar con tu propio lote de grabación real.

CAPA 2 — Transcripción + Análisis (semana 2)
  → Whisper + prompt Analista (igual al del MVP) → transcripts, analyses, assets.

CAPA 3+4 — Edit Director + Remotion (semana 3-5, la capa más pesada)
  → Construir 2 templates primero (educativo_v1 e historia_v1 — cubren la mayoría del contenido
    de una marca personal), NO los 5 de entrada.
  → Servicio de render self-hosted (Docker + Express + @remotion/renderer).
  → Prompt Edit Director + validación de schema del JSON antes de renderizar.
  → Los 3 templates restantes se agregan en la Capa 9 (cuando el motor de variantes empiece
    a pedir formatos que los 2 primeros no cubren) — no antes, para no construir plantillas
    que quizás no se usen.

CAPA 5 — Revisión humana vía Telegram (semana 5)
  → Botones aprobar/rechazar, tabla review_actions, feedback loop a Capa 3.

CAPA 6 — Publicación (semana 6)
  → Conectar Metricool/Publer (no Ayrshare todavía — no se justifica con 1 cliente).
  → social_accounts, publications, scheduling por horario.

CAPA 7+8 — Métricas + Scoring (semana 6-7)
  → Pull 24/48/72h/7d, benchmarks, función SQL de score_rendimiento.

CAPA 9 — Motor de variantes (semana 7-8)
  → Prompt de variantes con clasificación A/B, tabla scripts.
  → Aquí se agregan los templates Remotion 3-5 si el contenido lo pide.

CAPA 10 — Reporting + alertas (semana 8)
  → Reporte semanal + Telegram/WhatsApp.

── Punto de decisión: ¿el sistema funciona sobre tu propia marca? ──
   Si sí (publicación consistente + al menos 1 ganador detectado y su variante publicada):

CAPA 11 — Multi-tenant real / Agencia (semana 9-12+)
  → Onboarding de cliente 2: crear su client_id, brand_kit, social_accounts — si las Capas 0-10
    se construyeron con client_id desde el inicio, esto es *configuración*, no desarrollo.
  → Portal Next.js de revisión (reemplaza/complementa Telegram para clientes externos).
  → Migrar publicación a Ayrshare/Upload-Post si el volumen de cuentas lo justifica.
  → Activar cost_ledger real para calcular margen por cliente.
  → Remotion Lambda si hay renders concurrentes de varios clientes.
```

**Qué construir primero para que no haya retrabajo — resumen de una línea:** el esquema completo de Postgres con `client_id` y RLS en todas las tablas (Capa 0), porque es lo único que es carísimo de cambiar después; todo lo demás (templates, proveedor de publicación, interfaz de revisión) se puede sustituir sin tocar el modelo de datos.

### 23. Qué dejar preparado desde el día 1 para escalar a clientes

- `client_id` en cada tabla + RLS, aunque exista un solo cliente al inicio.
- `brand_kit` parametrizado (logo, colores, tono) — los templates Remotion **nunca** deben tener un color o logo hardcodeado.
- `social_accounts.publisher_provider` como campo, no una integración fija en el código de n8n.
- `cost_ledger` registrando desde el primer video (aunque no se use para facturar todavía) — sin esto, calcular margen real por cliente en el mes 3 exige reconstruir datos históricos que no existen.
- Workflows de n8n parametrizados por `client_id` (un solo workflow que itera clientes activos, no un workflow copiado por cliente — esto último es la trampa clásica que hace imposible mantener 10 clientes).
- Convención de nombres de storage por cliente (`raw/{client_id}/...`) desde el primer archivo subido.

### 24. Riesgos técnicos

1. **Costo/tiempo de render a escala:** Chromium headless renderizando video es intensivo en CPU; con muchos clientes concurrentes, un solo worker self-hosted se satura → mitigación: cola de renders (no disparar todos en paralelo) y migración a Remotion Lambda cuando el volumen lo pida.
2. **Calidad de los timestamps de Whisper:** si el audio es malo (ruido, eco), los cortes automáticos y la sincronía de subtítulos degradan → mitigación: la revisión humana (Capa 5) es justamente el freno de seguridad para esto, no se publica nada sin pasar por ahí.
3. **Cambios de política de API de TikTok/Meta:** puede romper publicación o medición sin aviso → mitigación: capa de publicación abstraída (sección 8), y fallback manual documentado para métricas.
4. **Fuga de datos entre clientes (multi-tenant):** RLS mal configurado es el riesgo más serio de un sistema de agencia → mitigación: RLS obligatorio desde Capa 0, tests automáticos de aislamiento antes de sumar el segundo cliente.
5. **Deriva de calidad del Edit Director:** el LLM puede generar JSON válido pero mal editado (cortes en mal lugar, énfasis mal puesto) → mitigación: métrica interna de "% de edit specs aprobados en el primer intento" por template, para detectar cuándo un template necesita ajuste de prompt.
6. **Costo de almacenamiento creciente:** brutos + renders + variantes por video suman rápido → mitigación: política de retención (borrar/archivar brutos no usados después de N meses) definida desde Capa 0, no improvisada después.

### 25. Costos estimados

**Infraestructura base (fija, independiente del número de clientes):**

| Ítem | Costo/mes |
|---|---|
| Supabase (plan Pro, cuando se supere el free tier) | US\$25 |
| n8n self-hosted (VPS 2-4 vCPU) | US\$15-25 |
| Servidor de render Remotion (VPS con más CPU, o Lambda pay-per-use) | US\$20-40 (self-host) / variable (Lambda) |
| **Subtotal base** | **~US\$60-90/mes** |

**Costo variable por cliente (activo, ~15-20 reels/mes):**

| Ítem | Costo/mes |
|---|---|
| Whisper (transcripción) | US\$5-10 |
| Claude/GPT (análisis + assets + edit spec + variantes) | US\$15-30 |
| Render Remotion (cómputo, si es Lambda: por minuto renderizado) | US\$10-25 |
| Publisher API (Metricool/Publer/Ayrshare, prorrateado) | US\$10-20 |
| **Subtotal por cliente** | **~US\$40-85/mes** |

A 5 clientes activos: infraestructura base (~US\$75) + 5 × (~US\$60 promedio) ≈ **US\$375/mes de costo total**, sobre el cual se calcula el pricing de la sección 26.

### 26. Modelo comercial — venderlo como servicio mensual

**Nombre comercial:** *"Fábrica de Reels" by Nexo.IA* — coherente con la marca ya posicionada de Evelin Hernández ("diagnóstico primero, automatización real").

**Problema que resuelve:** las marcas personales generan contenido de forma inconsistente porque cada paso después de grabar (editar, escribir caption, publicar en horario óptimo, medir, decidir qué repetir) depende de que el dueño tenga tiempo y ganas ese día. La Fábrica de Reels convierte eso en un sistema: grabás en lote, el sistema hace el resto y además aprende de lo que funciona.

**Cliente ideal:** igual que en el MVP — marca personal o profesional con visibilidad ya en marcha, factura suficiente para justificar el servicio, no tiene equipo de contenido propio.

**Estructura de planes:**

| Plan | Incluye | Setup | Mensual |
|---|---|---|---|
| **Starter** | 12 reels/mes, 2 templates, Metricool, revisión por Telegram | US\$500 | US\$250/mes |
| **Pro** | 20 reels/mes, 5 templates, motor de variantes activo, reporte semanal, portal de revisión propio | US\$800 | US\$450/mes |
| **Agency** (marca con equipo/varios voceros) | Multi-cuenta, publisher Ayrshare, SLA de revisión 24h, dashboard a medida | US\$1,500 | US\$800+/mes |

**Costo aproximado por cliente:** US\$40-85/mes (sección 25) + prorrateo de infraestructura base. **Margen estimado:** 65-80% en planes Pro/Agency una vez amortizado el setup; el setup mismo (principalmente configuración, no costo variable) deja margen alto desde el primer mes.

**Qué se entrega al cliente:** sistema configurado y corriendo sobre sus propias cuentas, acceso a su cola de revisión (Telegram al inicio, portal propio en plan Pro/Agency), publicación según plan, reporte semanal, guiones de variantes listos para su próximo lote de grabación.

**Garantía comercial:** primeras 2 semanas con ajuste de prompts/templates sin costo si el cliente no ve consistencia de publicación real (no se garantiza viralidad — se garantiza que el sistema publique, mida y aprenda de forma consistente).

**Cómo venderlo por WhatsApp:** mismo enfoque que en `sistema-piloto-reels.md` sección 15 — diagnóstico gratis corriendo el análisis (Capa 2) sobre 3-5 videos públicos del prospecto, mostrando el score y qué generaría el sistema, antes de cobrar nada. La diferencia ahora es que se puede mostrar además un **video de muestra ya editado por Remotion** (no solo un score en texto) como prueba de que el sistema edita de verdad, no solo organiza una planilla.
