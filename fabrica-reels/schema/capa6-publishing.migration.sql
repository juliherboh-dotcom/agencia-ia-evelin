-- Capa 6: publicación real en TikTok/Instagram vía proveedor intermedio.
-- Extiende `publications` (ya existía desde la arquitectura original,
-- poblada por Capa 5 al aprobar) y `social_accounts` (idem).

-- ─────────────────────────────────────────────────────────────────────
-- 1. publications: columnas de proveedor, reintentos y locking.
-- ─────────────────────────────────────────────────────────────────────
alter table publications
  add column if not exists provider text,
  add column if not exists provider_status text,
  add column if not exists error_message text,
  add column if not exists retry_count int not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists account_id uuid references social_accounts(id),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists updated_at timestamptz not null default now();

-- Nota de continuidad: NO se agrega una columna `provider_post_id` nueva
-- -- `external_post_id` ya cumplía exactamente ese propósito desde el
-- diseño original (sistema-fabrica-reels-nexoia.md, sección 9). Agregar
-- otra hubiera duplicado el mismo dato con otro nombre.

create index if not exists idx_publications_status on publications (status, next_attempt_at);
create index if not exists idx_publications_client on publications (client_id, platform);
create index if not exists idx_publications_locked on publications (locked_at) where locked_at is not null;

-- Defensa en profundidad: nunca dos publicaciones "vivas" (no fallidas)
-- para el mismo render+plataforma -- el candado (locked_at/locked_by) ya
-- evita procesar la misma fila dos veces en paralelo, esto evita que
-- existan directamente DOS FILAS activas para el mismo render+plataforma
-- (ej. por un doble-click en Capa 5 o una inserción manual duplicada).
create unique index if not exists idx_publications_unique_active
  on publications (render_id, platform)
  where status not in ('failed');

-- status ahora recorre: queued -> ready_to_schedule -> publishing ->
-- scheduled | published | failed (documentado en capa6-publishing.md).

-- ─────────────────────────────────────────────────────────────────────
-- 2. social_accounts: ya existía (client_id, platform, publisher_provider,
--    external_account_id, oauth_token_ref, status, connected_at). Se deja
--    tal cual -- para el proveedor recomendado (Upload-Post),
--    external_account_id es el "profile"/"user" que Upload-Post asigna al
--    conectar la cuenta del cliente, y oauth_token_ref queda sin uso real
--    (el proveedor gestiona el token de IG/TikTok de su lado, nunca lo
--    vemos nosotros -- ver capa6-publishing.md sección 9).
-- ─────────────────────────────────────────────────────────────────────
create index if not exists idx_social_accounts_client_platform
  on social_accounts (client_id, platform)
  where status = 'active';

-- ─────────────────────────────────────────────────────────────────────
-- 3. clients: timezone y reglas de espaciado para la programación.
-- ─────────────────────────────────────────────────────────────────────
alter table clients
  add column if not exists timezone text not null default 'America/Santiago',
  add column if not exists default_publish_hour_local int not null default 10,
  add column if not exists min_hours_between_posts int not null default 4;

-- ─────────────────────────────────────────────────────────────────────
-- 4. RLS pensando en multi-cliente (mismo criterio que Capa 5).
-- ─────────────────────────────────────────────────────────────────────
alter table publications enable row level security;
create policy publications_service_role_all on publications
  for all using (auth.role() = 'service_role');

alter table social_accounts enable row level security;
create policy social_accounts_service_role_all on social_accounts
  for all using (auth.role() = 'service_role');

-- Plantilla para el futuro portal (Capa 11), sin activar acá:
-- create policy publications_client_read on publications
--   for select using (
--     client_id in (select client_id from user_client_access where user_id = auth.uid())
--   );
-- social_accounts NUNCA debería exponerse por SELECT directo a un usuario
-- autenticado del portal más allá de "está conectada sí/no" -- no tiene
-- sentido mostrar external_account_id/oauth_token_ref crudos en un
-- frontend; el portal debería tener un endpoint propio que devuelva solo
-- el status, no la fila completa.
