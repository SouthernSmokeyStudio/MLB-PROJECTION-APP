-- Starter Intelligence Foundation
-- Slice 1: schema + ownership boundaries only
-- No ingest logic, no resolver behavior, no read-path wiring.

create table if not exists public.starter_sources (
    id          uuid    primary key default gen_random_uuid(),
    source_key  text    not null unique,
    source_name text    not null,
    source_type text    not null
                        check (source_type in ('official', 'projected', 'reported')),
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists public.game_starter_intelligence (
    id                    uuid primary key default gen_random_uuid(),
    game_id               text not null unique,
    game_date             date not null,
    away_team_abbreviation text not null,
    home_team_abbreviation text not null,

    -- Away side (all nullable — truth may be unknown)
    away_starter_player_id          text,
    away_starter_mlb_stats_api_id   text,
    away_starter_full_name          text,
    away_starter_source_key         text references public.starter_sources (source_key),
    away_starter_source_tier        text
                                    check (away_starter_source_tier in ('official', 'projected', 'reported', 'inferred')),
    away_starter_confidence         numeric
                                    check (away_starter_confidence between 0 and 1),
    away_starter_freshness_status   text
                                    check (away_starter_freshness_status in ('fresh', 'stale', 'unknown')),
    away_starter_observed_at        timestamptz,
    away_starter_source_updated_at  timestamptz,
    away_starter_status             text
                                    check (away_starter_status in ('confirmed', 'projected', 'reported', 'unknown')),
    away_starter_raw_ref            jsonb,

    -- Home side (all nullable — truth may be unknown)
    home_starter_player_id          text,
    home_starter_mlb_stats_api_id   text,
    home_starter_full_name          text,
    home_starter_source_key         text references public.starter_sources (source_key),
    home_starter_source_tier        text
                                    check (home_starter_source_tier in ('official', 'projected', 'reported', 'inferred')),
    home_starter_confidence         numeric
                                    check (home_starter_confidence between 0 and 1),
    home_starter_freshness_status   text
                                    check (home_starter_freshness_status in ('fresh', 'stale', 'unknown')),
    home_starter_observed_at        timestamptz,
    home_starter_source_updated_at  timestamptz,
    home_starter_status             text
                                    check (home_starter_status in ('confirmed', 'projected', 'reported', 'unknown')),
    home_starter_raw_ref            jsonb,

    -- Common
    resolution_notes text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

-- Indexes for common query patterns (date range, per-team lookups)
create index if not exists idx_game_starter_intelligence_game_date
    on public.game_starter_intelligence (game_date);

create index if not exists idx_game_starter_intelligence_away_team
    on public.game_starter_intelligence (away_team_abbreviation);

create index if not exists idx_game_starter_intelligence_home_team
    on public.game_starter_intelligence (home_team_abbreviation);
