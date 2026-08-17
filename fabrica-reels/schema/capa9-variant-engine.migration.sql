-- Capa 9: motor de variantes.
-- Extiende las tablas canonicas `scripts`, `edit_specs` y `raw_videos`;
-- no crea una tabla paralela de variantes.

alter table scripts
  add column if not exists parent_video_id uuid references raw_videos(id),
  add column if not exists variant_type_origen text,
  add column if not exists generation_key text;

create unique index if not exists idx_scripts_variant_generation_key
  on scripts (generation_key)
  where generation_key is not null;

create index if not exists idx_scripts_pending_recording
  on scripts (client_id, created_at)
  where status = 'pendiente_grabacion';

alter table edit_specs
  add column if not exists parent_edit_spec_id uuid references edit_specs(id),
  add column if not exists variant_type_origen text,
  add column if not exists generation_key text;

create unique index if not exists idx_edit_specs_variant_generation_key
  on edit_specs (generation_key)
  where generation_key is not null;

alter table raw_videos
  add column if not exists variant_generation_started_at timestamptz,
  add column if not exists variant_generation_completed_at timestamptz,
  add column if not exists variant_generation_attempts int not null default 0,
  add column if not exists variant_generation_error text;

-- Valores de variant_generation_status desde esta capa:
-- 'not_applicable' | 'ready' | 'in_progress' | 'variants_generated' | 'failed'
create index if not exists idx_raw_videos_variant_in_progress
  on raw_videos (variant_generation_started_at)
  where variant_generation_status = 'in_progress';

-- Un pedido manual de Capa 5 entra a la misma cola que un ganador de Capa 8.
-- El trigger evita acoplar/modificar el workflow de revision ya desplegado.
create or replace function enqueue_manual_variant_request()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'variant_requested'
     and old.status is distinct from new.status
     and new.variant_generation_status not in ('in_progress', 'variants_generated') then
    new.variant_generation_status := 'ready';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_manual_variant_request on raw_videos;
create trigger trg_enqueue_manual_variant_request
before update of status on raw_videos
for each row execute function enqueue_manual_variant_request();
