alter table edit_specs add column if not exists cut_qa_status text;
update edit_specs set cut_qa_status='passed' where cut_qa_status is null;
alter table edit_specs alter column cut_qa_status set default 'pending';
alter table edit_specs alter column cut_qa_status set not null;
do $$ begin
  alter table edit_specs add constraint edit_specs_cut_qa_status_check
    check (cut_qa_status in ('pending','in_progress','passed','flagged'));
exception when duplicate_object then null; end $$;
alter table edit_specs add column if not exists cut_qa_checked_at timestamptz;
alter table raw_videos add column if not exists cut_qa_feedback text;
create table if not exists cut_qa_results (
  id bigint generated always as identity primary key,
  edit_spec_id uuid not null references edit_specs(id), cut_index int not null,
  ok boolean not null, flagged_frame_time numeric, reason text, checked_at timestamptz not null default now()
);
create index if not exists idx_edit_specs_cut_qa_queue on edit_specs(created_at) where status='ready' and validation_status='valid' and cut_qa_status='pending';
create index if not exists idx_cut_qa_results_spec on cut_qa_results(edit_spec_id,checked_at);
