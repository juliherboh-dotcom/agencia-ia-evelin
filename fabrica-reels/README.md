# fabrica-reels — Capas 3 a 9 de la Fábrica de Reels (Nexo.IA)

Código base real del contrato (`edit_spec`), el orquestador n8n de Capa 3
(Edit Director), Capa 4 (render automático), Capa 5 (revisión y
aprobación), Capa 6 (publicación real), Capa 7-8 (métricas y scoring) y
Capa 9 (motor de variantes Tipo A/Tipo B).
Ver `../sistema-fabrica-reels-nexoia.md` para la arquitectura completa,
`../capa4-edit-spec-y-remotion.md` para el contrato + la composition
Remotion, `../capa3-edit-director-n8n.md` para el workflow que genera el
`edit_spec`, `../capa4-render.md` para el workflow que lo renderiza
automáticamente, `../capa5-review.md` para el sistema de
revisión/aprobación por Telegram, `../capa6-publishing.md` para la
publicación en TikTok/Instagram, `../capa7-8-metrics-scoring.md` para el
loop de métricas y detección de ganadores, y `../capa9-variant-engine.md`
para el motor de variantes.

```
fabrica-reels/
  package.json                       node_modules compartido (zod) para schema/ y validation/
  schema/
    edit-spec.schema.json             JSON Schema canónico (contrato portable)
    edit-spec.zod.ts                  Mismo contrato en Zod: valida + genera EditSpec (TS)
    safe-areas.ts                     Safe areas de TikTok/Instagram Reels
    edit-specs.migration.sql          SQL Capa 3→4: columnas de validación en edit_specs
    capa4-render.migration.sql        SQL Capa 4: columnas de render/idempotencia
    capa5-review.migration.sql        SQL Capa 5: reviewers, review_sessions, review_actions extendida
    capa6-publishing.migration.sql    SQL Capa 6: publications extendida, social_accounts, timezone/scheduling
    capa7-8-metrics-scoring.migration.sql   SQL Capa 7-8: post_metrics, account_benchmarks, scores, raw_videos
    capa9-variant-engine.migration.sql      SQL Capa 9: trazabilidad, idempotencia y cola manual
    examples/
      valid-edit-spec.json
      invalid-edit-spec.json
  validation/
    validateEditSpec.ts               Validación estructural (Zod) + semántica (reglas de negocio)
    repair-prompt.ts                  Prompt correctivo para el LLM cuando el JSON es inválido
    generateValidEditSpec.ts          Bucle de reparación (hasta 3 intentos)
  prompts/
    edit-director-system-prompt.md    Rol, reglas y criterios del Edit Director
    variant-director-system-prompt.md Variantes A/B basadas en evidencia del ganador
    nexoia-brand-voice.md             Voz de marca Nexo.IA (pieza enchufable por cliente)
  services/
    edit-spec-api/                    /validate, /repair-prompt, prompts Edit/Variant Director
    publish-api/                      Contrato PublishJob/PublishResult + adapters (mock, upload_post)
    metrics-api/                      Contrato MetricsProvider + calculatePerformanceScore()
  remotion/
    src/
      compositions/PersonalBrandClean/   Composition de referencia (template)
      render/                            renderEditSpec.ts, renderLocal.ts, renderService.ts
      Root.tsx, index.ts
    sample-data/example-edit-spec.json
  n8n/
    capa3-edit-director.workflow.json    Genera el edit_spec con el LLM
    capa4-render.workflow.json           Dispara el render, sube el MP4 (v2: sin botones de revisión)
    capa5-review.workflow.json           Revisión/aprobación por Telegram, deja listo para publicar
    capa6-publishing.workflow.json       Publica en TikTok/Instagram vía proveedor intermedio
    capa7-metrics.workflow.json          Recolecta snapshots 24h/48h/72h/7d
    capa8-scoring.workflow.json          Calcula score, benchmark y marca ganadores
    capa9-variant-engine.workflow.json   Genera 2-3 Tipo B y 5-7 Tipo A
    code-nodes/                          Nodos Code como archivos sueltos (testeables aparte)
```

## Quickstart

```bash
# Instalar el node_modules compartido primero (zod, usado por schema/ y validation/)
cd fabrica-reels && npm install

# Terminal 1 — Capa 3
cd fabrica-reels/services/edit-spec-api && npm install && npm start   # :3002

# Terminal 2 — Capa 4
cd fabrica-reels/remotion
npm install
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export N8N_RENDER_CALLBACK_URL=http://localhost:5678/webhook/render-callback
npm run render:service   # :3001

# Terminal 3 — Capa 6
cd fabrica-reels/services/publish-api && npm install && npm start   # :3003

# Terminal 4 — Capa 7-8
cd fabrica-reels/services/metrics-api && npm install && npm start   # :3004

# Abrir Remotion Studio con la Composition PersonalBrandClean cargada con
# el ejemplo de sample-data/example-edit-spec.json:
cd fabrica-reels/remotion && npm start

# Renderizar ese mismo ejemplo a MP4 localmente, sin pasar por Supabase ni
# por el render service (para iterar sobre el template):
npm run render:local

# Terminal 5 — n8n, con las 7 capas importadas y activas
# (ver fabrica-reels/n8n/README.md) -- correr antes todas las migraciones
# SQL en orden (capa5, capa6, capa7-8, capa9) y dar de alta un reviewer + una
# social_accounts activa (usar provider='mock' para probar sin publicar
# ni medir de verdad)
```

## Regla más importante del contrato

`cuts[].start/end` están en la línea de tiempo del **video fuente**
original. Todo lo demás (`hook`, `subtitles.lines`, `overlays`,
`zoom_keyframes`) está en la línea de tiempo **final ya editada**, de 0 a
`duration.target_sec`. Confundir estas dos líneas de tiempo es el error más
común al escribir un `edit_spec` a mano o al ajustar el prompt del Edit
Director.

## El ciclo completo hoy

```
video bruto → transcripción → Edit Director (Capa 3) → edit_spec válido
  → Supabase → render automático (Capa 4) → MP4 final en Storage
  → rendered_pending_review → revisión por Telegram (Capa 5)
  → approved_for_publish → publications:queued
  → Capa 6 → published en TikTok/Instagram (o simulado con provider='mock')
  → Capa 7 → snapshots 24h/48h/72h/7d
  → Capa 8 → score 0-100 + benchmark + variant_generation_status='ready'
    si score ≥ 70 (ganador) o ≥ 85 (super ganador)
  → Capa 9 → 2-3 edit_specs Tipo B + 5-7 scripts Tipo A
    → variant_generation_status='variants_generated'
```

Pendiente (próximas capas): reporte semanal (Capa 10) y portal de revisión
propio (Capa 11).
