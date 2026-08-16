-- Capa 7-8: métricas y scoring.
-- Renombra y extiende las tablas que ya existían desde la arquitectura
-- original (sistema-fabrica-reels-nexoia.md, sección 9: `metrics`,
-- `benchmarks`, `scores`) en vez de crear tablas paralelas con otro
-- nombre para el mismo propósito.

-- ─────────────────────────────────────────────────────────────────────
-- 1. metrics -> post_metrics (rename + columnas nuevas)
-- ─────────────────────────────────────────────────────────────────────
alter table if exists metrics rename to post_metrics;

alter table post_metrics
  add column if not exists client_id uuid references clients(id),
  add column if not exists raw_video_id uuid references raw_videos(id),
  add column if not exists render_id uuid references renders(id),
  add column if not exists account_id uuid references social_accounts(id),
  add column if not exists platform text,
  add column if not exists follows int,
  add column if not exists profile_visits int,
  add column if not exists completion_rate numeric,
  add column if not exists engagement_rate numeric,
  add column if not exists confidence_level text not null default 'medium', -- 'high' | 'medium' | 'low'
  add column if not exists raw_payload jsonb;

-- Nota de continuidad: la tabla original ya tenía `window` -- se
-- renombra a `snapshot_window` para que coincida con el nombre pedido y
-- no choque con la palabra reservada `window` de SQL en queries futuras
-- más complejas (window functions).
alter table post_metrics rename column window to snapshot_window;
alter table post_metrics rename column measured_at to snapshot_at;
-- `retention_avg` original pasa a ser `retention_rate` (0-1), mismo dato.
alter table post_metrics rename column retention_avg to retention_rate;
-- `followers_gained` original pasa a ser `follows` -- si la columna
-- `follows` ya se agregó arriba como nueva, este rename no aplica dos
-- veces; se deja documentado el mapeo por si la tabla original ya tenía
-- datos cargados con el nombre viejo:
-- alter table post_metrics rename column followers_gained to follows;

-- Nunca dos snapshots para la misma publicación+ventana.
create unique index if not exists idx_post_metrics_unique_window
  on post_metrics (publication_id, snapshot_window);

create index if not exists idx_post_metrics_client_platform_window
  on post_metrics (client_id, platform, snapshot_window);
create index if not exists idx_post_metrics_raw_video on post_metrics (raw_video_id);
create index if not exists idx_post_metrics_source on post_metrics (source);

-- source ahora puede valer: 'api' | 'manual' | 'estimated' | 'failed'
-- (failed = se intentó y el provider no pudo, se guarda igual para no
-- reintentar de más -- ver capa7-8-metrics-scoring.md sección 8).

-- ─────────────────────────────────────────────────────────────────────
-- 2. benchmarks -> account_benchmarks (rename + columnas nuevas)
-- ─────────────────────────────────────────────────────────────────────
alter table if exists benchmarks rename to account_benchmarks;

alter table account_benchmarks
  add column if not exists platform text,
  add column if not exists window text, -- '24h' | '48h' | '72h' | '7d'
  add column if not exists avg_likes numeric,
  add column if not exists avg_comments numeric,
  add column if not exists avg_shares numeric,
  add column if not exists avg_saves numeric,
  add column if not exists avg_follows numeric,
  add column if not exists avg_profile_visits numeric,
  add column if not exists avg_retention_rate numeric,
  add column if not exists avg_completion_rate numeric,
  add column if not exists min_samples_required int not null default 5,
  add column if not exists sample_count int not null default 0;

-- La tabla original tenía `period` (ej. 'rolling_30d') como única
-- dimensión -- se reemplaza por platform+window, que es lo que Capa 8
-- realmente necesita para comparar manzanas con manzanas (TikTok a 24h
-- contra TikTok a 24h, no contra el promedio general de la cuenta).
alter table account_benchmarks drop column if exists period;

create unique index if not exists idx_account_benchmarks_unique
  on account_benchmarks (client_id, platform, window);

-- ─────────────────────────────────────────────────────────────────────
-- 3. scores: extender con lo que hace falta para Capa 8.
-- ─────────────────────────────────────────────────────────────────────
alter table scores
  add column if not exists raw_video_id uuid references raw_videos(id),
  add column if not exists metric_snapshot_id uuid references post_metrics(id),
  add column if not exists platform text, -- plataforma real, o 'consolidated' para el score multi-plataforma
  add column if not exists window text,
  add column if not exists benchmark_confidence text, -- 'account' | 'fallback_generic'
  add column if not exists components jsonb; -- breakdown de calculatePerformanceScore(), para debug/dashboard

-- Un score por snapshot (nunca se recalcula pisando el mismo, cada
-- ventana tiene su propio score que se puede comparar en el tiempo).
create unique index if not exists idx_scores_unique_snapshot
  on scores (metric_snapshot_id)
  where metric_snapshot_id is not null;

-- Un solo score consolidado por raw_video+ventana (publication_id NULL
-- en esas filas, platform='consolidated').
create unique index if not exists idx_scores_unique_consolidated
  on scores (raw_video_id, window, platform);

create index if not exists idx_scores_raw_video on scores (raw_video_id, window);
create index if not exists idx_scores_classification on scores (classification);

-- classification ahora usa 5 niveles (antes eran 4):
--   malo (0-39) | normal (40-59) | prometedor (60-69) | ganador (70-84) | super_ganador (85-100)

-- ─────────────────────────────────────────────────────────────────────
-- 4. raw_videos: estado de rendimiento, separado del estado de pipeline.
--    `status` sigue siendo el ciclo de producción (assets_ready ->
--    edit_spec_ready -> ... -> published); esto es una dimensión
--    ortogonal que no lo pisa.
-- ─────────────────────────────────────────────────────────────────────
alter table raw_videos
  add column if not exists best_score numeric,
  add column if not exists performance_classification text,
  add column if not exists variant_generation_status text not null default 'not_applicable';
  -- 'not_applicable' | 'ready' | 'in_progress' | 'done' -- Capa 9 consume 'ready'

create index if not exists idx_raw_videos_variant_ready
  on raw_videos (variant_generation_status)
  where variant_generation_status = 'ready';

-- ─────────────────────────────────────────────────────────────────────
-- 5. Vistas útiles para el futuro dashboard/reporte semanal (Capa 10).
-- ─────────────────────────────────────────────────────────────────────
create or replace view v_client_winners as
select
  rv.id as raw_video_id,
  rv.client_id,
  rv.filename,
  rv.best_score,
  rv.performance_classification,
  rv.variant_generation_status,
  rv.uploaded_at
from raw_videos rv
where rv.performance_classification in ('ganador', 'super_ganador');

create or replace view v_weekly_performance as
select
  p.client_id,
  p.platform,
  date_trunc('week', p.published_at) as week_start,
  count(*) as posts_published,
  avg(s.score_rendimiento) as avg_score,
  count(*) filter (where s.classification in ('ganador', 'super_ganador')) as winners_count
from publications p
join scores s on s.publication_id = p.id and s.window = '7d'
where p.status = 'published'
group by p.client_id, p.platform, date_trunc('week', p.published_at);

-- ─────────────────────────────────────────────────────────────────────
-- 6. RLS multi-cliente (mismo criterio que capas anteriores).
-- ─────────────────────────────────────────────────────────────────────
alter table post_metrics enable row level security;
create policy post_metrics_service_role_all on post_metrics
  for all using (auth.role() = 'service_role');

alter table account_benchmarks enable row level security;
create policy account_benchmarks_service_role_all on account_benchmarks
  for all using (auth.role() = 'service_role');

alter table scores enable row level security;
create policy scores_service_role_all on scores
  for all using (auth.role() = 'service_role');

-- Plantilla para el futuro portal (Capa 11), sin activar acá:
-- create policy post_metrics_client_read on post_metrics
--   for select using (client_id in (select client_id from user_client_access where user_id = auth.uid()));
-- Las vistas v_client_winners / v_weekly_performance heredan RLS de las
-- tablas base solo si se crean con `security_invoker = true` (Postgres
-- 15+) -- revisar la versión de Postgres del proyecto Supabase antes de
-- exponer estas vistas directamente a un rol no service_role.
