-- Extiende `renders` (definida en sistema-fabrica-reels-nexoia.md, sección 9)
-- y `raw_videos` con lo necesario para el patrón async de Capa 4: disparo
-- de render, callback de resultado, idempotencia y revisión mínima por
-- Telegram (preparando el terreno de Capa 5).

alter table renders
  add column if not exists raw_video_id uuid references raw_videos(id),
  add column if not exists public_url text,
  add column if not exists error_message text,
  add column if not exists stage text, -- 'render' | 'upload' | null (null = sin fallo)
  add column if not exists attempt int not null default 1,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_renders_edit_spec on renders (edit_spec_id, created_at desc);
create index if not exists idx_renders_raw_video on renders (raw_video_id);
create index if not exists idx_renders_status on renders (status);

alter table raw_videos
  add column if not exists render_attempts int not null default 0;

-- Valores nuevos que puede tomar raw_videos.status a partir de esta capa.
-- status sigue siendo texto libre (sin constraint de enum) -- documentado
-- acá para que el vocabulario quede claro:
--
--   rendering                  render disparado, esperando el webhook de resultado
--   rendered_pending_review    render OK, esperando aprobar/rechazar/pedir variante
--   failed_render_validation   el edit_spec no pasó la revalidación en Capa 4
--                              (requiere que Capa 3 lo regenere, no se reintenta solo)
--   failed_render_dispatch     no se pudo ni disparar el render tras 3 intentos
--                              (render service caído / inaccesible)
--   failed_render              Remotion falló renderizando
--   failed_upload              renderizó bien pero no se pudo subir a Storage
--   failed_render_timeout      quedó colgado más de 10 min sin respuesta
--                              (lo detectó el sweep del schedule trigger)
--   approved / rejected / variant_requested   decisión tomada en la
--                              revisión mínima de Telegram (Capa 5 real la
--                              reemplaza más adelante, no estos valores)
--
-- review_actions.decision ahora también puede valer 'variant_requested'
-- (columna de texto libre en el diseño original, sin constraint -- no
-- requiere migración de esquema).

-- Bucket de Supabase Storage: crear manualmente (no es SQL) un bucket
-- PRIVADO llamado "renders" -- las URLs de revisión se generan siempre
-- firmadas (createSignedUrl, 7 días de validez), nunca públicas, porque el
-- contenido es de un cliente.
