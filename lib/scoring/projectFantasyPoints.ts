import type { PlayerFantasyProjection } from "@lib/contracts/projections";
import { DK_CLASSIC_RULES_V1 } from "@lib/contracts/scoring";
import type { BlockedState } from "@lib/contracts/types";
import type { AssembledGameProjection } from "../projections/assembleGameProjection";
import { deriveBatterFantasyPoints, derivePitcherFantasyPoints } from "./deriveFantasyPoints";

export interface FantasyProjectionPackage {
  readonly blocked: BlockedState;
  readonly pitcher_fantasy_points: readonly PlayerFantasyProjection[];
  readonly batter_fantasy_points: readonly PlayerFantasyProjection[];
}

const buildBlocked = (reason: string): FantasyProjectionPackage => ({
  blocked: {
    is_blocked: true,
    blocked_reason: reason
  },
  pitcher_fantasy_points: [],
  batter_fantasy_points: []
});

export const projectFantasyPoints = (
  assembled: AssembledGameProjection
): FantasyProjectionPackage => {
  if (assembled.game_projection.metadata.blocked.is_blocked) {
    return buildBlocked(
      assembled.game_projection.metadata.blocked.blocked_reason ?? "Upstream projection package is blocked"
    );
  }

  const pitcherProjections: PlayerFantasyProjection[] = [];

  for (const pitcher of [assembled.away_pitcher, assembled.home_pitcher]) {
    if (!pitcher) {
      return buildBlocked("Missing pitcher projection required for fantasy scoring");
    }

    const projectedPoints = derivePitcherFantasyPoints(
      {
        projected_ip: pitcher.projected_ip,
        projected_k: pitcher.projected_k,
        projected_er: pitcher.projected_er,
        projected_hits: pitcher.projected_hits,
        projected_bb: pitcher.projected_bb,
        projected_win_probability: pitcher.win_probability,
        projected_hbp_allowed: 0,      // Phase 4 does not expose pitcher HBP projections yet.
        projected_complete_game: 0,    // Phase 4 does not expose complete-game likelihood.
        projected_shutout: 0,          // Phase 4 does not expose shutout likelihood.
        projected_no_hitter: 0         // Phase 4 does not expose no-hitter likelihood.
      },
      DK_CLASSIC_RULES_V1
    );

    pitcherProjections.push({
      player_id: pitcher.player_id,
      team_id: pitcher.team_id,
      game_id: pitcher.game_id,
      platform: DK_CLASSIC_RULES_V1.platform,
      contest_type: DK_CLASSIC_RULES_V1.contest_type,
      projected_points: projectedPoints,
      projected_points_std: null,
      ceiling: null,
      floor: null,
      salary: null,
      value: null
    });
  }

  const batterProjections: PlayerFantasyProjection[] = [];

  for (const batter of [...assembled.away_batters, ...assembled.home_batters]) {
    const projectedPoints = deriveBatterFantasyPoints(
      {
        projected_singles: batter.projected_singles,
        projected_doubles: batter.projected_doubles,
        projected_triples: batter.projected_triples,
        projected_hr: batter.projected_hr,
        projected_rbi: batter.projected_rbi,
        projected_runs: batter.projected_runs,
        projected_bb: batter.projected_bb,
        projected_hbp: 0,  // Phase 4 does not expose batter HBP projections yet.
        projected_sb: batter.projected_sb,
        projected_cs: 0    // Phase 4 does not expose caught-stealing projections yet.
      },
      DK_CLASSIC_RULES_V1
    );

    batterProjections.push({
      player_id: batter.player_id,
      team_id: batter.team_id,
      game_id: batter.game_id,
      platform: DK_CLASSIC_RULES_V1.platform,
      contest_type: DK_CLASSIC_RULES_V1.contest_type,
      projected_points: projectedPoints,
      projected_points_std: null,
      ceiling: null,
      floor: null,
      salary: null,
      value: null
    });
  }

  return {
    blocked: {
      is_blocked: false,
      blocked_reason: null
    },
    pitcher_fantasy_points: pitcherProjections,
    batter_fantasy_points: batterProjections
  };
};
