-- Capa 5: modelo completo de revisión y aprobación.
-- Orden importa (reviewers y review_sessions se crean antes de que
-- review_actions les agregue foreign keys).

-- ─────────────────────────────────────────────────────────────────────
-- 1. reviewers: quién tiene permiso de revisar videos de qué cliente.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists reviewers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  telegram_user_id text,        -- id numérico de Telegram (from.id), NO el username
  telegram_username text,       -- solo para mostrar, puede cambiar
  display_name text,
  role text not null default 'reviewer',  -- 'reviewer' | 'admin'
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_reviewers_client_telegram
  on reviewers (client_id, telegram_user_id)
  where telegram_user_id is not null;

-- ─────────────────────────────────────────────────────────────────────
-- 2. review_sessions: estado transitorio de una revisión que necesita un
--    paso conversacional (comentario, o elegir tipo de variante) antes
--    de poder finalizarse. Sin esto, "Rechazar" tendría que resolverse
--    en un solo click sin poder pedir motivo.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists review_sessions (
  id uuid primary key default gen_random_uuid(),
  render_id uuid not null references renders(id),
  raw_video_id uuid not null references raw_videos(id),
  chat_id text not null,
  reviewer_telegram_user_id text,
  pending_action text not null,  -- 'reject' | 'needs_changes' | 'error_flagged' | 'variant_requested'
  variant_type text,             -- se llena en el paso de selección, si pending_action='variant_requested'
  status text not null default 'awaiting_variant_type',
    -- 'awaiting_variant_type' | 'awaiting_comment' | 'completed' | 'expired'
  prompt_message_id text,        -- id del mensaje de Telegram donde se pidió el comentario
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);

create index if not exists idx_review_sessions_chat_pending
  on review_sessions (chat_id, status)
  where status in ('awaiting_comment', 'awaiting_variant_type');

create index if not exists idx_review_sessions_expiry
  on review_sessions (status, expires_at)
  where status in ('awaiting_comment', 'awaiting_variant_type');

-- ─────────────────────────────────────────────────────────────────────
-- 3. review_actions: extender el diseño original
--    (render_id, reviewer, decision, comment, decided_at) con lo que
--    hace falta para el modelo completo. `reviewer` (texto libre, ej.
--    'telegram:@usuario') se mantiene tal cual estaba -- reviewer_id es
--    la referencia estructurada opcional a `reviewers`.
-- ─────────────────────────────────────────────────────────────────────
alter table review_actions
  add column if not exists reviewer_id uuid references reviewers(id),
  add column if not exists variant_type text,
  add column if not exists session_id uuid references review_sessions(id);

create index if not exists idx_review_actions_render on review_actions (render_id, decided_at desc);
create index if not exists idx_review_actions_session on review_actions (session_id);

-- decision ahora puede valer, además de lo que ya existía:
--   'approved' | 'rejected' | 'needs_changes' | 'variant_requested' |
--   'error_flagged' | 'rerender_requested' | 'retry_requested'
-- (columna de texto libre, sin constraint -- no requiere migración de
-- esquema para agregar valores nuevos).

-- ─────────────────────────────────────────────────────────────────────
-- 4. raw_videos / clients: columnas nuevas para Capa 5.
-- ─────────────────────────────────────────────────────────────────────
alter table raw_videos
  add column if not exists review_prompt_sent_at timestamptz;

alter table clients
  add column if not exists telegram_chat_id text;  -- multi-tenant real de las alertas

-- Nuevos valores de raw_videos.status a partir de esta capa (texto
-- libre, documentado acá):
--   approved_for_publish   aprobado, listo para que Capa 6 lo tome
--   rejected                rechazado, con comentario/motivo en review_actions
--   needs_changes           el reviewer pidió cambios manuales (edición humana, no variante)
--   variant_requested        se pidió una variante automática (con variant_type + comentario)
--   error_flagged            el reviewer marcó el render como técnicamente roto

-- ─────────────────────────────────────────────────────────────────────
-- 5. publications: NO se crea una tabla `publish_jobs` nueva -- ya existe
--    (sistema-fabrica-reels-nexoia.md, sección 9) con el mismo propósito.
--    Solo hace falta que tenga raw_video_id para poder correlacionarla
--    directamente sin pasar siempre por render_id.
-- ─────────────────────────────────────────────────────────────────────
alter table publications
  add column if not exists raw_video_id uuid references raw_videos(id);

create index if not exists idx_publications_status on publications (status);

-- ─────────────────────────────────────────────────────────────────────
-- 6. RLS pensando en multi-cliente.
--    Política base: el service_role (que usan n8n y renderService) puede
--    todo. Cualquier acceso futuro desde un portal con Supabase Auth por
--    usuario necesita una tabla de mapeo user_id -> client_id que todavía
--    no existe (se agrega junto con el portal, Capa 11) -- las políticas
--    de solo-lectura por cliente quedan comentadas como plantilla.
-- ─────────────────────────────────────────────────────────────────────
alter table reviewers enable row level security;
create policy reviewers_service_role_all on reviewers
  for all using (auth.role() = 'service_role');

alter table review_sessions enable row level security;
create policy review_sessions_service_role_all on review_sessions
  for all using (auth.role() = 'service_role');

alter table review_actions enable row level security;
create policy review_actions_service_role_all on review_actions
  for all using (auth.role() = 'service_role');

-- Plantilla para cuando exista el portal (Capa 11) -- NO se activa acá:
--
-- create table user_client_access (user_id uuid references auth.users(id), client_id uuid references clients(id));
--
-- create policy review_actions_client_read on review_actions
--   for select using (
--     render_id in (
--       select r.id from renders r
--       join raw_videos rv on rv.id = r.raw_video_id
--       join user_client_access uca on uca.client_id = rv.client_id
--       where uca.user_id = auth.uid()
--     )
--   );
--
-- Nunca se agrega UPDATE/DELETE directo para usuarios autenticados sobre
-- review_actions -- las decisiones siempre se escriben a través de un
-- endpoint/workflow controlado (Telegram hoy, el portal después), nunca
-- editando la tabla a mano, para no perder el historial de auditoría.
