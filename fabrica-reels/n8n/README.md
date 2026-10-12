# Workflows n8n — Capa 2B a Capa 9

## Capa 2B — "Perfil de estilo"

Workflow importable: [`capa2b-style-profile.workflow.json`](./capa2b-style-profile.workflow.json)
Documentación completa: [`../../capa2b-style-profile.md`](../../capa2b-style-profile.md)

On-demand, no corre en loop fijo como las demás: convierte un lote de 1-20 referencias en un `style_profile` reusable por cliente (fuentes, paleta, ritmo de corte, patrones de tarjetas). Si existe una versión `active`, Capa 3 la incorpora al prompt del Edit Director; si no existe o Supabase no responde, Capa 3 sigue con el prompt genérico sin bloquearse.

**Servicios que necesita corriendo:** el mismo `edit-spec-api` de Capa 3 (`:3002`) — no levanta nada aparte.

## Capa 3 — "Edit Director"

Workflow importable: [`capa3-edit-director.workflow.json`](./capa3-edit-director.workflow.json)
Documentación completa: [`../../capa3-edit-director-n8n.md`](../../capa3-edit-director-n8n.md)

Detecta `raw_videos.status='assets_ready'`, genera el `edit_spec` con el LLM, lo valida (repair loop de hasta 3 intentos) y lo deja en `edit_spec_ready`.

**Servicios que necesita corriendo:**
```bash
cd fabrica-reels/services/edit-spec-api && npm install && npm start   # :3002
```

## Capa 3.5 — "QA visual por corte"

Workflow importable: [`capa3-5-cut-qa.workflow.json`](./capa3-5-cut-qa.workflow.json)
Documentación completa: [`../../capa3-5-cut-qa.md`](../../capa3-5-cut-qa.md)

Detecta `edit_specs` válidos y `pending`, revisa con Anthropic Vision 4 frames representativos (inicio/33%/66%/fin) de cada corte `keep:true`. Si todos aprueban, deja `cut_qa_status=passed` y el video vuelve a `edit_spec_ready` — Capa 4 exige expresamente ese estado antes de renderizar. Si algo falla, queda `flagged` y Telegram recibe fotos + motivo + botones ("Aprobar igual" / "Pedir regenerar ese corte").

**Servicios que necesita corriendo:** el mismo `edit-spec-api` de Capa 3 (`:3002`), más credencial de Telegram Bot para las alertas de `flagged`.

## Capa 4 — "Render automático"

Workflow importable: [`capa4-render.workflow.json`](./capa4-render.workflow.json) (v2 — ya no maneja botones de revisión, eso es Capa 5)
Documentación completa: [`../../capa4-render.md`](../../capa4-render.md)

Detecta `raw_videos.status='edit_spec_ready'`, dispara el render (async) con `personal_brand_clean`, sube el MP4 a Supabase Storage y deja el video en `rendered_pending_review`. Si el render falla, avisa por Telegram con un botón de reintento.

**Servicios que necesita corriendo:**
```bash
cd fabrica-reels/remotion && npm install && npm run render:service   # :3001
```

## Capa 5 — "Revisión y aprobación"

Workflow importable: [`capa5-review.workflow.json`](./capa5-review.workflow.json)
Documentación completa: [`../../capa5-review.md`](../../capa5-review.md)

Detecta `raw_videos.status='rendered_pending_review'`, manda el mensaje interactivo de revisión (7 acciones) por Telegram, procesa las decisiones (incluido el paso de pedir comentario/tipo de variante), y deja el video en `approved_for_publish` / `rejected` / `needs_changes` / `variant_requested` / `error_flagged`. Al aprobar, deja lista una fila en `publications` para Capa 6.

**No necesita servicios propios corriendo** (solo `renderService` de Capa 4, para el botón "Regenerar link").

## Capa 6 — "Publicación"

Workflow importable: [`capa6-publishing.workflow.json`](./capa6-publishing.workflow.json)
Documentación completa: [`../../capa6-publishing.md`](../../capa6-publishing.md)

Detecta `publications.status='queued'` (creadas por Capa 5), arma el caption final, calcula horario respetando timezone/espaciado, publica vía el proveedor configurado (`mock` para pruebas, `upload_post` en real) con locking anti-duplicados, y deja la fila en `published`/`scheduled`/`failed`.

**Servicios que necesita corriendo:**
```bash
cd fabrica-reels/services/publish-api && npm install && npm start   # :3003
```

## Capa 7 — "Métricas" y Capa 8 — "Scoring"

Workflows importables: [`capa7-metrics.workflow.json`](./capa7-metrics.workflow.json), [`capa8-scoring.workflow.json`](./capa8-scoring.workflow.json)
Documentación completa: [`../../capa7-8-metrics-scoring.md`](../../capa7-8-metrics-scoring.md)

Capa 7 (cada 30 min) recolecta snapshots 24h/48h/72h/7d para `publications.status='published'` y los guarda en `post_metrics`. Capa 8 (cada 15 min, independiente) calcula el score de rendimiento de cada snapshot nuevo, actualiza el benchmark de cuenta+plataforma+ventana, y marca `raw_videos.variant_generation_status='ready'` cuando un video cruza el umbral de ganador (score ≥70) — la cola que va a leer Capa 9.

**Servicios que necesita corriendo:**
```bash
cd fabrica-reels/services/metrics-api && npm install && npm start   # :3004
```

## Capa 9 — "Motor de variantes"

Workflow importable: [`capa9-variant-engine.workflow.json`](./capa9-variant-engine.workflow.json)
Documentación completa: [`../../capa9-variant-engine.md`](../../capa9-variant-engine.md)

Detecta `raw_videos.variant_generation_status='ready'` (ganadores que dejó Capa 8, o pedidos manuales), genera 2-3 re-cortes automáticos del mismo video fuente (Tipo B, cada uno una nueva versión de `edit_specs` ya validada) y 5-7 guiones nuevos para grabar (Tipo A, `scripts.status='pendiente_grabacion'`), manda una alerta con ambos conteos y cierra en `variants_generated` — nunca reprocesa el mismo ganador dos veces.

**Servicios que necesita corriendo:** el mismo `edit-spec-api` de Capa 3 (`:3002`) — no levanta nada aparte.

## Cómo importar cualquiera de las nueve

1. n8n → Workflows → Import from File.
2. Revisar visualmente los nodos **"Procesar de a uno/a"** (Loop Over
   Items / Split In Batches, presentes en Capa 2B, 3, 3.5, 4, 6, 7, 8 y 9):
   sus dos salidas son "done" (índice 0, sin nada conectado, fin del ciclo) y
   "loop" (índice 1, conecta al resto del flujo). El orden exacto de
   estos índices varía un poco según la versión de n8n — si al importar
   el wiring queda cruzado, es el único lugar donde hay que corregir a mano.
3. Cargar las env vars (ver tabla en cada doc).
4. Crear la credencial de Telegram Bot en n8n y asignarla al nodo
   `n8n-nodes-base.telegramTrigger` de Capa 5 (los envíos de mensajes ya no
   usan nodos nativos de Telegram, llaman directo a la Bot API por HTTP
   desde los nodos Code — solo el *receptor* de updates sigue siendo el
   nodo nativo).
5. En Capa 4: configurar `N8N_RENDER_CALLBACK_URL` en el entorno del
   render service apuntando a la URL pública del nodo Webhook
   `Recibir resultado de render` (n8n te la da al abrir el nodo — "Test
   URL" en desarrollo, "Production URL" con el workflow activo).
6. En Capa 5: correr `fabrica-reels/schema/capa5-review.migration.sql` y
   dar de alta al menos un `reviewer` activo antes de activar el workflow.
7. En Capa 6: correr `fabrica-reels/schema/capa6-publishing.migration.sql`
   y dar de alta al menos una `social_accounts` activa por cliente+plataforma
   (`publisher_provider='mock'` para probar sin publicar de verdad).
8. En Capa 7-8: correr `fabrica-reels/schema/capa7-8-metrics-scoring.migration.sql`
   (esta migración renombra `metrics`→`post_metrics` y `benchmarks`→`account_benchmarks`
   si venías de la arquitectura original — revisar que no haya datos que
   dependan del nombre viejo antes de correrla en producción).
9. En Capa 2B: correr `fabrica-reels/schema/capa2b-style-profile.migration.sql`.
   Es opcional activarla — Capa 3 funciona igual sin ningún perfil `active`,
   solo usa el prompt genérico.
10. En Capa 3.5: correr `fabrica-reels/schema/capa3-5-cut-qa.migration.sql`.
    Esta capa es un gate real: Capa 4 exige `cut_qa_status=passed` antes de
    renderizar, así que si no la activás, ningún `edit_spec` va a pasar a
    render nunca (queda trabado en `pending`/`flagged`).
11. En Capa 9: correr `fabrica-reels/schema/capa9-variant-engine.migration.sql`.
12. Activar las nueve. **Si tenías una v1 vieja de Capa 4** (con nodos de
    Telegram para revisión), desactivala antes de activar Capa 5 — si
    quedan las dos escuchando el mismo bot, un mismo click se procesa dos
    veces.

## Orden recomendado para levantar todo

```bash
# Terminal 1
cd fabrica-reels/services/edit-spec-api && npm install && npm start   # :3002

# Terminal 2
cd fabrica-reels/remotion && npm install && npm run render:service    # :3001

# Terminal 3
cd fabrica-reels/services/publish-api && npm install && npm start     # :3003

# Terminal 4
cd fabrica-reels/services/metrics-api && npm install && npm start     # :3004

# Terminal 5: n8n, con las 9 capas importadas y activas
# (Capa 2B, 3.5 y 9 reusan edit-spec-api -- Terminal 1 -- no levantan nada propio)
```
