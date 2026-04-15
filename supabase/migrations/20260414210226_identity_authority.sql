create extension if not exists pgcrypto;

create type public.identity_state as enum (
  'draft',
  'held',
  'published',
  'superseded',
  'retired'
);

create type public.identity_mapping_state as enum (
  'candidate',
  'held',
  'published',
  'superseded',
  'retired'
);

create type public.identity_override_state as enum (
  'active',
  'retired'
);

create type public.identity_conflict_state as enum (
  'open',
  'fail_closed',
  'resolved_override',
  'resolved_publish',
  'retired'
);

create type public.identity_source_system as enum (
  'statsapi',
  'dk'
);

create type public.identity_match_method as enum (
  'source_id_exact',
  'normalized_name_team_exact',
  'manual_override',
  'fail_closed'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.dim_player_canonical (
  canonical_identity_version_id bigint generated always as identity primary key,
  canonical_player_id uuid not null default gen_random_uuid(),
  identity_version integer not null,
  canonical_full_name text not null,
  canonical_slug text not null,
  identity_state public.identity_state not null default 'draft',
  published_at timestamptz null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  is_active boolean not null default false,
  supersedes_canonical_identity_version_id bigint null
    references public.dim_player_canonical(canonical_identity_version_id),
  lineage_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_dim_player_canonical_player_version
    unique (canonical_player_id, identity_version),

  constraint uq_dim_player_canonical_slug_version
    unique (canonical_slug, identity_version),

  constraint ck_dim_player_canonical_effective_window
    check (effective_to is null or effective_to > effective_from),

  constraint ck_dim_player_canonical_published_state
    check (
      (identity_state = 'published' and published_at is not null)
      or (identity_state <> 'published')
    ),

  constraint ck_dim_player_canonical_active_alignment
    check (
      (
        is_active = true
        and identity_state = 'published'
        and published_at is not null
        and effective_to is null
      )
      or
      (
        is_active = false
      )
    ),

  constraint ck_dim_player_canonical_retired_inactive
    check (
      identity_state not in ('superseded', 'retired') or is_active = false
    )
);

create unique index uq_dim_player_canonical_active_player
  on public.dim_player_canonical (canonical_player_id)
  where is_active;

create index ix_dim_player_canonical_slug
  on public.dim_player_canonical (canonical_slug);

create table public.map_player_statsapi (
  statsapi_mapping_id bigint generated always as identity primary key,
  canonical_identity_version_id bigint not null
    references public.dim_player_canonical(canonical_identity_version_id),
  statsapi_player_id bigint not null,
  source_full_name text null,
  source_team_abbreviation text null,
  mapping_state public.identity_mapping_state not null default 'candidate',
  match_method public.identity_match_method not null,
  policy_version text not null,
  published_at timestamptz null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  is_active boolean not null default false,
  supersedes_statsapi_mapping_id bigint null
    references public.map_player_statsapi(statsapi_mapping_id),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_map_player_statsapi_version
    unique (canonical_identity_version_id, statsapi_player_id, policy_version),

  constraint ck_map_player_statsapi_effective_window
    check (effective_to is null or effective_to > effective_from),

  constraint ck_map_player_statsapi_published_state
    check (
      (mapping_state = 'published' and published_at is not null)
      or (mapping_state <> 'published')
    ),

  constraint ck_map_player_statsapi_active_alignment
    check (
      (
        is_active = true
        and mapping_state = 'published'
        and published_at is not null
        and effective_to is null
      )
      or
      (
        is_active = false
      )
    ),

  constraint ck_map_player_statsapi_retired_inactive
    check (
      mapping_state not in ('superseded', 'retired') or is_active = false
    )
);

create unique index uq_map_player_statsapi_active_source
  on public.map_player_statsapi (statsapi_player_id)
  where is_active;

create index ix_map_player_statsapi_identity_version
  on public.map_player_statsapi (canonical_identity_version_id);

create table public.map_player_dk (
  dk_mapping_id bigint generated always as identity primary key,
  canonical_identity_version_id bigint not null
    references public.dim_player_canonical(canonical_identity_version_id),
  dk_player_id text not null,
  source_full_name text null,
  source_team_abbreviation text null,
  mapping_state public.identity_mapping_state not null default 'candidate',
  match_method public.identity_match_method not null,
  policy_version text not null,
  published_at timestamptz null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  is_active boolean not null default false,
  supersedes_dk_mapping_id bigint null
    references public.map_player_dk(dk_mapping_id),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_map_player_dk_version
    unique (canonical_identity_version_id, dk_player_id, policy_version),

  constraint ck_map_player_dk_effective_window
    check (effective_to is null or effective_to > effective_from),

  constraint ck_map_player_dk_published_state
    check (
      (mapping_state = 'published' and published_at is not null)
      or (mapping_state <> 'published')
    ),

  constraint ck_map_player_dk_active_alignment
    check (
      (
        is_active = true
        and mapping_state = 'published'
        and published_at is not null
        and effective_to is null
      )
      or
      (
        is_active = false
      )
    ),

  constraint ck_map_player_dk_retired_inactive
    check (
      mapping_state not in ('superseded', 'retired') or is_active = false
    )
);

create unique index uq_map_player_dk_active_source
  on public.map_player_dk (dk_player_id)
  where is_active;

create index ix_map_player_dk_identity_version
  on public.map_player_dk (canonical_identity_version_id);

create table public.map_player_override (
  override_id bigint generated always as identity primary key,
  source_system public.identity_source_system not null,
  source_player_id text not null,
  canonical_identity_version_id bigint not null
    references public.dim_player_canonical(canonical_identity_version_id),
  override_state public.identity_override_state not null default 'active',
  override_reason text not null,
  policy_version text not null,
  published_at timestamptz not null default now(),
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  is_active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_map_player_override_source_version
    unique (source_system, source_player_id, policy_version),

  constraint ck_map_player_override_effective_window
    check (effective_to is null or effective_to > effective_from),

  constraint ck_map_player_override_active_alignment
    check (
      (
        is_active = true
        and override_state = 'active'
        and effective_to is null
      )
      or
      (
        is_active = false
      )
    )
);

create unique index uq_map_player_override_active_source
  on public.map_player_override (source_system, source_player_id)
  where is_active;

create index ix_map_player_override_identity_version
  on public.map_player_override (canonical_identity_version_id);

create table public.audit_identity_conflict (
  conflict_id bigint generated always as identity primary key,
  source_system public.identity_source_system not null,
  source_player_id text not null,
  source_full_name text null,
  source_team_abbreviation text null,
  policy_version text not null,
  tie_break_rule_version text not null,
  match_step_1_source_id_exact_count integer not null default 0,
  match_step_2_normalized_name_team_exact_count integer not null default 0,
  deterministic_step_reached smallint not null,
  selected_by_step smallint null,
  failed_at_step smallint null,
  decision_path jsonb not null default '[]'::jsonb,
  conflict_state public.identity_conflict_state not null default 'open',
  failed_closed boolean not null default true,
  reason_code text not null,
  selected_canonical_identity_version_id bigint null
    references public.dim_player_canonical(canonical_identity_version_id),
  selected_override_id bigint null
    references public.map_player_override(override_id),
  candidate_rows jsonb not null default '[]'::jsonb,
  resolution_note text null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  retired_at timestamptz null,

  constraint ck_audit_identity_conflict_step
    check (deterministic_step_reached between 1 and 4),

  constraint ck_audit_identity_conflict_selected_by_step
    check (selected_by_step is null or selected_by_step between 1 and 4),

  constraint ck_audit_identity_conflict_failed_at_step
    check (failed_at_step is null or failed_at_step between 1 and 4),

  constraint ck_audit_identity_conflict_fail_closed_shape
    check (
      (
        conflict_state = 'fail_closed'
        and failed_closed = true
        and selected_canonical_identity_version_id is null
        and selected_override_id is null
        and failed_at_step is not null
      )
      or conflict_state <> 'fail_closed'
    ),

  constraint ck_audit_identity_conflict_resolved_override_shape
    check (
      (
        conflict_state = 'resolved_override'
        and selected_override_id is not null
        and selected_by_step is not null
      )
      or conflict_state <> 'resolved_override'
    ),

  constraint ck_audit_identity_conflict_resolved_publish_shape
    check (
      (
        conflict_state = 'resolved_publish'
        and selected_canonical_identity_version_id is not null
        and selected_by_step is not null
      )
      or conflict_state <> 'resolved_publish'
    )
);

create index ix_audit_identity_conflict_source
  on public.audit_identity_conflict (source_system, source_player_id, created_at desc);

create index ix_audit_identity_conflict_state
  on public.audit_identity_conflict (conflict_state);

create trigger trg_dim_player_canonical_updated_at
before update on public.dim_player_canonical
for each row execute function public.set_updated_at();

create trigger trg_map_player_statsapi_updated_at
before update on public.map_player_statsapi
for each row execute function public.set_updated_at();

create trigger trg_map_player_dk_updated_at
before update on public.map_player_dk
for each row execute function public.set_updated_at();

create trigger trg_map_player_override_updated_at
before update on public.map_player_override
for each row execute function public.set_updated_at();

alter table public.dim_player_canonical enable row level security;
alter table public.map_player_statsapi enable row level security;
alter table public.map_player_dk enable row level security;
alter table public.map_player_override enable row level security;
alter table public.audit_identity_conflict enable row level security;

create policy dim_player_canonical_ops_read
  on public.dim_player_canonical
  for select
  to authenticated
  using ((auth.jwt() ->> 'app_role') in ('ops_admin', 'ops_read'));

create policy map_player_statsapi_ops_read
  on public.map_player_statsapi
  for select
  to authenticated
  using ((auth.jwt() ->> 'app_role') in ('ops_admin', 'ops_read'));

create policy map_player_dk_ops_read
  on public.map_player_dk
  for select
  to authenticated
  using ((auth.jwt() ->> 'app_role') in ('ops_admin', 'ops_read'));

create policy map_player_override_ops_read
  on public.map_player_override
  for select
  to authenticated
  using ((auth.jwt() ->> 'app_role') in ('ops_admin', 'ops_read'));

create policy audit_identity_conflict_ops_read
  on public.audit_identity_conflict
  for select
  to authenticated
  using ((auth.jwt() ->> 'app_role') in ('ops_admin', 'ops_read'));

create policy dim_player_canonical_ops_write
  on public.dim_player_canonical
  for all
  to authenticated
  using ((auth.jwt() ->> 'app_role') = 'ops_admin')
  with check ((auth.jwt() ->> 'app_role') = 'ops_admin');

create policy map_player_statsapi_ops_write
  on public.map_player_statsapi
  for all
  to authenticated
  using ((auth.jwt() ->> 'app_role') = 'ops_admin')
  with check ((auth.jwt() ->> 'app_role') = 'ops_admin');

create policy map_player_dk_ops_write
  on public.map_player_dk
  for all
  to authenticated
  using ((auth.jwt() ->> 'app_role') = 'ops_admin')
  with check ((auth.jwt() ->> 'app_role') = 'ops_admin');

create policy map_player_override_ops_write
  on public.map_player_override
  for all
  to authenticated
  using ((auth.jwt() ->> 'app_role') = 'ops_admin')
  with check ((auth.jwt() ->> 'app_role') = 'ops_admin');

create policy audit_identity_conflict_ops_write
  on public.audit_identity_conflict
  for all
  to authenticated
  using ((auth.jwt() ->> 'app_role') = 'ops_admin')
  with check ((auth.jwt() ->> 'app_role') = 'ops_admin');

-- Service role bypasses RLS in Supabase by design; no extra policy needed here.