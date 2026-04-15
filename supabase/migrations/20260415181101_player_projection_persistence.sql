create table public.projection_run (
  run_id uuid primary key,
  projected_at timestamptz not null,
  player_projection_formula_version text not null,
  parameter_set_version text not null,
  prepared_input_lineage_ref text not null,
  team_run_lineage_ref text not null
);

create table public.player_projection_batter (
  run_id uuid not null references public.projection_run(run_id) on delete cascade,
  game_id text not null,
  player_id text not null,
  team_id text not null,
  projected_pa numeric not null,
  projected_ab numeric not null,
  projected_singles numeric not null,
  projected_doubles numeric not null,
  projected_triples numeric not null,
  projected_hr numeric not null,
  projected_rbi numeric not null,
  projected_runs numeric not null,
  projected_bb numeric not null,
  projected_sb numeric not null,
  lineup_path text not null,
  used_fallback_season_bb_rate boolean not null,
  used_fallback_season_hr_rate boolean not null,
  used_fallback_season_sb boolean not null,
  used_fallback_season_woba boolean not null,
  constraint pk_player_projection_batter
    primary key (run_id, game_id, player_id),
  constraint ck_player_projection_batter_lineup_path
    check (lineup_path in ('confirmed_order', 'season_stats_fallback'))
);

create index ix_player_projection_batter_game_id
  on public.player_projection_batter (game_id);

create index ix_player_projection_batter_run_player
  on public.player_projection_batter (run_id, player_id);

create table public.player_projection_pitcher (
  run_id uuid not null references public.projection_run(run_id) on delete cascade,
  game_id text not null,
  player_id text not null,
  team_id text not null,
  projected_ip numeric not null,
  projected_k numeric not null,
  projected_er numeric not null,
  projected_hits numeric not null,
  projected_bb numeric not null,
  constraint pk_player_projection_pitcher
    primary key (run_id, game_id, player_id)
);

create index ix_player_projection_pitcher_game_id
  on public.player_projection_pitcher (game_id);

create index ix_player_projection_pitcher_run_player
  on public.player_projection_pitcher (run_id, player_id);
