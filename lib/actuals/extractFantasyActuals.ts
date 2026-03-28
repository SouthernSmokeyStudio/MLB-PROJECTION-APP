import type { ActualFantasyOutcome, ActualPlayerOutcome } from "@lib/contracts/actuals";
import { DK_CLASSIC_RULES_V1 } from "@lib/contracts/scoring";
import {
  deriveBatterFantasyPoints,
  derivePitcherFantasyPoints
} from "@lib/scoring/deriveFantasyPoints";

const round2 = (value: number): number => Math.round(value * 100) / 100;

const isPitcherActual = (actual: ActualPlayerOutcome): boolean =>
  actual.ip !== null || actual.strikeouts !== null || actual.earned_runs !== null;

export const extractFantasyActuals = (
  actuals: readonly ActualPlayerOutcome[]
): readonly ActualFantasyOutcome[] =>
  actuals.map((actual) => {
    const actual_points = isPitcherActual(actual)
      ? derivePitcherFantasyPoints(
          {
            projected_ip: actual.ip ?? 0,
            projected_k: actual.strikeouts ?? 0,
            projected_er: actual.earned_runs ?? 0,
            projected_hits: actual.hits ?? 0,
            projected_bb: actual.walks ?? 0,
            projected_win_probability: actual.win === null ? null : actual.win ? 1 : 0,
            projected_hbp_allowed: actual.hbp ?? 0,
            projected_complete_game: actual.complete_game === null ? 0 : actual.complete_game ? 1 : 0,
            projected_shutout: actual.shutout === null ? 0 : actual.shutout ? 1 : 0,
            projected_no_hitter: actual.no_hitter === null ? 0 : actual.no_hitter ? 1 : 0
          },
          DK_CLASSIC_RULES_V1
        )
      : deriveBatterFantasyPoints(
          {
            projected_singles: actual.singles ?? 0,
            projected_doubles: actual.doubles ?? 0,
            projected_triples: actual.triples ?? 0,
            projected_hr: actual.home_runs ?? 0,
            projected_rbi: actual.rbi ?? 0,
            projected_runs: actual.runs ?? 0,
            projected_bb: actual.walks ?? 0,
            projected_hbp: actual.hbp ?? 0,
            projected_sb: actual.stolen_bases ?? 0,
            projected_cs: actual.caught_stealing ?? 0
          },
          DK_CLASSIC_RULES_V1
        );

    return {
      player_id: actual.player_id,
      game_id: actual.game_id,
      platform: DK_CLASSIC_RULES_V1.platform,
      contest_type: DK_CLASSIC_RULES_V1.contest_type,
      actual_points: round2(actual_points),
      salary: null
    };
  });
