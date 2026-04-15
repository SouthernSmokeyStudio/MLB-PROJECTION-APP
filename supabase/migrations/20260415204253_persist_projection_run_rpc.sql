create or replace function public.persist_projection_run(
  run jsonb,
  batters jsonb,
  pitchers jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.projection_run (
    run_id,
    projected_at,
    player_projection_formula_version,
    parameter_set_version,
    prepared_input_lineage_ref,
    team_run_lineage_ref
  )
  select
    x.run_id::uuid,
    x.projected_at::timestamptz,
    x.player_projection_formula_version,
    x.parameter_set_version,
    x.prepared_input_lineage_ref,
    x.team_run_lineage_ref
  from jsonb_to_record(run) as x(
    run_id text,
    projected_at text,
    player_projection_formula_version text,
    parameter_set_version text,
    prepared_input_lineage_ref text,
    team_run_lineage_ref text
  );

  insert into public.player_projection_batter (
    run_id,
    game_id,
    player_id,
    team_id,
    projected_pa,
    projected_ab,
    projected_singles,
    projected_doubles,
    projected_triples,
    projected_hr,
    projected_rbi,
    projected_runs,
    projected_bb,
    projected_sb,
    lineup_path,
    used_fallback_season_bb_rate,
    used_fallback_season_hr_rate,
    used_fallback_season_sb,
    used_fallback_season_woba
  )
  select
    x.run_id::uuid,
    x.game_id,
    x.player_id,
    x.team_id,
    x.projected_pa,
    x.projected_ab,
    x.projected_singles,
    x.projected_doubles,
    x.projected_triples,
    x.projected_hr,
    x.projected_rbi,
    x.projected_runs,
    x.projected_bb,
    x.projected_sb,
    x.lineup_path,
    x.used_fallback_season_bb_rate,
    x.used_fallback_season_hr_rate,
    x.used_fallback_season_sb,
    x.used_fallback_season_woba
  from jsonb_to_recordset(batters) as x(
    run_id text,
    game_id text,
    player_id text,
    team_id text,
    projected_pa numeric,
    projected_ab numeric,
    projected_singles numeric,
    projected_doubles numeric,
    projected_triples numeric,
    projected_hr numeric,
    projected_rbi numeric,
    projected_runs numeric,
    projected_bb numeric,
    projected_sb numeric,
    lineup_path text,
    used_fallback_season_bb_rate boolean,
    used_fallback_season_hr_rate boolean,
    used_fallback_season_sb boolean,
    used_fallback_season_woba boolean
  );

  insert into public.player_projection_pitcher (
    run_id,
    game_id,
    player_id,
    team_id,
    projected_ip,
    projected_k,
    projected_er,
    projected_hits,
    projected_bb
  )
  select
    x.run_id::uuid,
    x.game_id,
    x.player_id,
    x.team_id,
    x.projected_ip,
    x.projected_k,
    x.projected_er,
    x.projected_hits,
    x.projected_bb
  from jsonb_to_recordset(pitchers) as x(
    run_id text,
    game_id text,
    player_id text,
    team_id text,
    projected_ip numeric,
    projected_k numeric,
    projected_er numeric,
    projected_hits numeric,
    projected_bb numeric
  );
end;
$$;

revoke all on function public.persist_projection_run(jsonb, jsonb, jsonb) from public;
revoke all on function public.persist_projection_run(jsonb, jsonb, jsonb) from anon;
revoke all on function public.persist_projection_run(jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.persist_projection_run(jsonb, jsonb, jsonb) to service_role;
