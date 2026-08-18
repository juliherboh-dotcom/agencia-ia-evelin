create table if not exists style_profiles (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references clients(id),
  label text not null, fonts jsonb, color_palette jsonb, cut_pacing jsonb,
  card_patterns jsonb, audio_notes jsonb, source_video_refs jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','in_progress','active','failed','archived')),
  created_at timestamptz not null default now(), version int not null default 1,
  processing_error text
);
create index if not exists idx_style_profiles_queue on style_profiles(created_at) where status='pending';
create index if not exists idx_style_profiles_active on style_profiles(client_id,version desc,created_at desc) where status='active';
