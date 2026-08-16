# fabrica-reels — Capa 3/4 de la Fábrica de Reels (Nexo.IA)

Código base real de la capa de contrato (`edit_spec`) y de la capa de render
(Remotion). Ver `../sistema-fabrica-reels-nexoia.md` para la arquitectura
completa y `../capa4-edit-spec-y-remotion.md` para la explicación detallada
de este código.

```
fabrica-reels/
  schema/
    edit-spec.schema.json      JSON Schema canónico (contrato portable)
    edit-spec.zod.ts           Mismo contrato en Zod: valida + genera EditSpec (TS)
    safe-areas.ts               Safe areas de TikTok/Instagram Reels
    edit-specs.migration.sql   SQL para Supabase (columnas + índices + pg_jsonschema opcional)
    examples/
      valid-edit-spec.json
      invalid-edit-spec.json
  validation/
    validateEditSpec.ts        Validación estructural (Zod) + semántica (reglas de negocio)
    repair-prompt.ts           Prompt correctivo para el LLM cuando el JSON es inválido
    generateValidEditSpec.ts   Bucle de reparación (hasta 3 intentos)
  remotion/
    src/
      compositions/PersonalBrandClean/   Composition de referencia (template)
      render/                            renderEditSpec.ts, renderLocal.ts, renderService.ts
      Root.tsx, index.ts
    sample-data/example-edit-spec.json
```

## Quickstart

```bash
cd fabrica-reels/remotion
npm install

# Abrir Remotion Studio con la Composition PersonalBrandClean cargada con
# el ejemplo de sample-data/example-edit-spec.json:
npm start

# Renderizar ese mismo ejemplo a MP4 localmente (valida antes de renderizar):
npm run render:local

# Levantar el servicio HTTP que n8n llama en la Capa 4 (necesita
# SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno):
npm run render:service
```

## Regla más importante del contrato

`cuts[].start/end` están en la línea de tiempo del **video fuente**
original. Todo lo demás (`hook`, `subtitles.lines`, `overlays`,
`zoom_keyframes`) está en la línea de tiempo **final ya editada**, de 0 a
`duration.target_sec`. Confundir estas dos líneas de tiempo es el error más
común al escribir un `edit_spec` a mano o al ajustar el prompt del Edit
Director.
