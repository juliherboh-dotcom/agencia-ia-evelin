# fabrica-reels — Capas 3 a 6 de la Fábrica de Reels (Nexo.IA)

Código base real del contrato (`edit_spec`), el orquestador n8n de Capa 3
(Edit Director), Capa 4 (render automático), Capa 5 (revisión y
aprobación) y Capa 6 (publicación real). Ver `../sistema-fabrica-reels-nexoia.md`
para la arquitectura completa, `../capa4-edit-spec-y-remotion.md` para el
contrato + la composition Remotion, `../capa3-edit-director-n8n.md` para el
workflow que genera el `edit_spec`, `../capa4-render.md` para el workflow
que lo renderiza automáticamente, `../capa5-review.md` para el sistema de
revisión/aprobación por Telegram, y `../capa6-publishing.md` para la
publicación en TikTok/Instagram.

```
fabrica-reels/
  package.json                    node_modules compartido (zod) para schema/ y validation/
  schema/
    edit-spec.schema.json          JSON Schema canónico (contrato portable)
    edit-spec.zod.ts               Mismo contrato en Zod: valida + genera EditSpec (TS)
    safe-areas.ts                  Safe areas de TikTok/Instagram Reels
    edit-specs.migration.sql       SQL Capa 3→4: columnas de validación en edit_specs
    capa4-render.migration.sql     SQL Capa 4: columnas de render/idempotencia
    capa5-review.migration.sql     SQL Capa 5: reviewers, review_sessions, review_actions extendida
    capa6-publishing.migration.sql SQL Capa 6: publications extendida, social_accounts, timezone/scheduling
    examples/
      valid-edit-spec.json
      invalid-edit-spec.json
  validation/
    validateEditSpec.ts            Validación estructural (Zod) + semántica (reglas de negocio)
    repair-prompt.ts               Prompt correctivo para el LLM cuando el JSON es inválido
    generateValidEditSpec.ts       Bucle de reparación (hasta 3 intentos)
  prompts/
    edit-director-system-prompt.md Rol, reglas y criterios del Edit Director
    nexoia-brand-voice.md          Voz de marca Nexo.IA (pieza enchufable por cliente)
  services/
    edit-spec-api/                 /validate, /repair-prompt, /prompts/edit-director-system
    publish-api/                   Contrato PublishJob/PublishResult + adapters (mock, upload_post)
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
    code-nodes/                          Nodos Code como archivos sueltos (testeables aparte)
```

## Quickstart

```bash
# Instalar el node_modules compartido primero (zod, usado por schema/ y validation/)
cd fabrica-reels && npm install

# Terminal 1 — Capa 3
cd fabrica-reels/services/edit-spec-api
npm install
npm start          # :3002

# Terminal 2 — Capa 4
cd fabrica-reels/remotion
npm install
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export N8N_RENDER_CALLBACK_URL=http://localhost:5678/webhook/render-callback
npm run render:service   # :3001

# Terminal 3 — Capa 6
cd fabrica-reels/services/publish-api
npm install
npm start          # :3003

# Abrir Remotion Studio con la Composition PersonalBrandClean cargada con
# el ejemplo de sample-data/example-edit-spec.json:
cd fabrica-reels/remotion && npm start

# Renderizar ese mismo ejemplo a MP4 localmente, sin pasar por Supabase ni
# por el render service (para iterar sobre el template):
npm run render:local

# Terminal 4 — n8n, con las 4 capas importadas y activas
# (ver fabrica-reels/n8n/README.md) -- correr antes las migraciones SQL
# (capa5-review.migration.sql, capa6-publishing.migration.sql) y dar de
# alta un reviewer + una social_accounts activa (usar provider='mock'
# para probar sin publicar de verdad)
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
```

Pendiente (próximas capas): medir métricas 24/48/72h/7d, scoring, motor de
variantes real (hoy solo se captura la intención en `variant_requested`),
portal de revisión propio.
