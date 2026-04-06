create extension if not exists pgcrypto;

create table if not exists public.run_artifacts (
    id uuid primary key default gen_random_uuid(),
    run_key text not null unique,
    run_date date,
    pipeline_mode text not null,
    status text not null,
    blocked_reason text,
    artifact_uri text,
    artifact_checksum text,
    metadata jsonb not null default '{}'::jsonb,
    is_stale boolean not null default false,
    stale_reason text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.game_projections (
    id uuid primary key default gen_random_uuid(),
    projection_date date not null,
    game_id text not null,
    sport_id text not null default 'MLB',
    away_team_id text not null,
    home_team_id text not null,
    projected_away_runs numeric,
    projected_home_runs numeric,
    projected_total_runs numeric,
    confidence_band text,
    is_blocked boolean not null default true,
    blocked_reason text,
    is_stale boolean not null default false,
    stale_reason text,
    source_run_key text,
    source_generated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (projection_date, game_id)
);

create table if not exists public.player_projections (
    id uuid primary key default gen_random_uuid(),
    projection_date date not null,
    game_id text not null,
    player_id text not null,
    team_id text not null,
    projection_type text not null,
    projected_value numeric,
    floor_value numeric,
    ceiling_value numeric,
    confidence_band text,
    is_blocked boolean not null default true,
    blocked_reason text,
    is_stale boolean not null default false,
    stale_reason text,
    source_run_key text,
    source_generated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (projection_date, game_id, player_id, projection_type)
);

create table if not exists public.smoke_signals (
    id uuid primary key default gen_random_uuid(),
    signal_date date not null,
    entity_type text not null,
    entity_id text not null,
    signal_key text not null,
    signal_level text not null,
    signal_reason text,
    is_stale boolean not null default false,
    stale_reason text,
    source_run_key text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (signal_date, entity_type, entity_id, signal_key)
);

create table if not exists public.governed_game_outcomes (
    id uuid primary key default gen_random_uuid(),
    game_id text not null,
    sport_id text not null default 'MLB',
    away_team_id text not null,
    home_team_id text not null,
    candidate_side text not null,
    predicted_home_win_probability numeric not null,
    review_tier text not null,
    review_status text not null,
    review_decision_reason text,
    run_id text not null,
    generated_at_utc timestamptz not null,
    is_stale boolean not null default false,
    stale_reason text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint governed_game_outcomes_candidate_side_check
        check (candidate_side in ('HOME', 'AWAY')),
    constraint governed_game_outcomes_review_tier_check
        check (review_tier in ('TIER_1', 'TIER_2')),
    constraint governed_game_outcomes_review_status_check
        check (review_status in ('APPROVED', 'REJECTED')),
    constraint governed_game_outcomes_probability_check
        check (
            predicted_home_win_probability >= 0
            and predicted_home_win_probability <= 1
        ),
    unique (sport_id, game_id, run_id)
);

alter table public.run_artifacts enable row level security;
alter table public.game_projections enable row level security;
alter table public.player_projections enable row level security;
alter table public.smoke_signals enable row level security;
alter table public.governed_game_outcomes enable row level security;

drop policy if exists "Service role can write run_artifacts" on public.run_artifacts;
create policy "Service role can write run_artifacts"
    on public.run_artifacts
    for all
    to service_role
    using (true)
    with check (true);

drop policy if exists "Public can read game_projections" on public.game_projections;
create policy "Public can read game_projections"
    on public.game_projections
    for select
    to anon, authenticated
    using (true);

drop policy if exists "Service role can write game_projections" on public.game_projections;
create policy "Service role can write game_projections"
    on public.game_projections
    for all
    to service_role
    using (true)
    with check (true);

drop policy if exists "Public can read player_projections" on public.player_projections;
create policy "Public can read player_projections"
    on public.player_projections
    for select
    to anon, authenticated
    using (true);

drop policy if exists "Service role can write player_projections" on public.player_projections;
create policy "Service role can write player_projections"
    on public.player_projections
    for all
    to service_role
    using (true)
    with check (true);

drop policy if exists "Public can read smoke_signals" on public.smoke_signals;
create policy "Public can read smoke_signals"
    on public.smoke_signals
    for select
    to anon, authenticated
    using (true);

drop policy if exists "Service role can write smoke_signals" on public.smoke_signals;
create policy "Service role can write smoke_signals"
    on public.smoke_signals
    for all
    to service_role
    using (true)
    with check (true);

drop policy if exists "Public can read governed_game_outcomes" on public.governed_game_outcomes;
create policy "Public can read governed_game_outcomes"
    on public.governed_game_outcomes
    for select
    to anon, authenticated
    using (true);

drop policy if exists "Service role can write governed_game_outcomes" on public.governed_game_outcomes;
create policy "Service role can write governed_game_outcomes"
    on public.governed_game_outcomes
    for all
    to service_role
    using (true)
    with check (true);
