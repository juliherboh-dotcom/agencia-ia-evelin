-- Extiende la tabla edit_specs (definida en sistema-fabrica-reels-nexoia.md,
-- sección 9) con lo necesario para guardar el resultado de la validación y
-- habilitar defensa en profundidad a nivel de base de datos.

alter table edit_specs
  add column if not exists schema_version text not null default '1.0.0',
  add column if not exists validation_status text not null default 'pending',
    -- pending | valid | invalid
  add column if not exists validation_errors jsonb,
  add column if not exists repair_attempts int not null default 0;

-- Columnas generadas desde el jsonb para poder filtrar/indexar sin tener
-- que parsear spec_json en cada query (ej. "dame todos los edit_specs
-- pendientes de render del template X").
alter table edit_specs
  add column if not exists template_id text generated always as (spec_json ->> 'template_id') stored,
  add column if not exists platform text generated always as (spec_json ->> 'platform') stored;

create index if not exists idx_edit_specs_spec_json on edit_specs using gin (spec_json);
create index if not exists idx_edit_specs_raw_video on edit_specs (raw_video_id, version desc);
create index if not exists idx_edit_specs_template on edit_specs (template_id);
create index if not exists idx_edit_specs_validation_status on edit_specs (validation_status);

-- Defensa en profundidad (opcional pero recomendada): Supabase soporta la
-- extensión pg_jsonschema, que permite validar spec_json contra el MISMO
-- archivo edit-spec.schema.json a nivel de Postgres. No reemplaza la
-- validación semántica (esa vive solo en TypeScript, en validateEditSpec.ts)
-- pero evita que una escritura directa a la tabla -- fuera del flujo normal
-- de n8n/el servicio de render -- salte la validación estructural.
--
-- create extension if not exists pg_jsonschema;
--
-- alter table edit_specs
--   add constraint edit_specs_spec_json_matches_schema
--   check (
--     json_matches_schema(
--       '<< pegar acá el contenido completo de edit-spec.schema.json >>'::json,
--       spec_json
--     )
--   );
