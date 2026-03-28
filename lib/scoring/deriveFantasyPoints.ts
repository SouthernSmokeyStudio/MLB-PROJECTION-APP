import type { DKClassicScoringRules } from "@lib/contracts/scoring";

export interface PitcherFantasyStatLine {
  readonly projected_ip: number;
  readonly projected_k: number;
  readonly projected_er: number;
  readonly projected_hits: number;
  readonly projected_bb: number;
  readonly projected_win_probability: number | null;
  readonly projected_hbp_allowed: number | null;
  readonly projected_complete_game: number | null;
  readonly projected_shutout: number | null;
  readonly projected_no_hitter: number | null;
}

export interface BatterFantasyStatLine {
  readonly projected_singles: number;
  readonly projected_doubles: number;
  readonly projected_triples: number;
  readonly projected_hr: number;
  readonly projected_rbi: number;
  readonly projected_runs: number;
  readonly projected_bb: number;
  readonly projected_hbp: number | null;
  readonly projected_sb: number;
  readonly projected_cs: number | null;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export const derivePitcherFantasyPoints = (
  statLine: PitcherFantasyStatLine,
  rules: DKClassicScoringRules
): number => {
  const winPoints =
    statLine.projected_win_probability === null
      ? 0
      : statLine.projected_win_probability * rules.pitcher.win;

  const hbpPoints =
    (statLine.projected_hbp_allowed ?? 0) * rules.pitcher.hbp;

  const completeGamePoints =
    (statLine.projected_complete_game ?? 0) * rules.pitcher.complete_game;

  const shutoutPoints =
    (statLine.projected_shutout ?? 0) * rules.pitcher.shutout;

  const noHitterPoints =
    (statLine.projected_no_hitter ?? 0) * rules.pitcher.no_hitter;

  return round2(
    statLine.projected_ip * rules.pitcher.inning_pitched +
    statLine.projected_k * rules.pitcher.strikeout +
    winPoints +
    statLine.projected_er * rules.pitcher.earned_run +
    statLine.projected_hits * rules.pitcher.hit +
    statLine.projected_bb * rules.pitcher.walk +
    hbpPoints +
    completeGamePoints +
    shutoutPoints +
    noHitterPoints
  );
};

export const deriveBatterFantasyPoints = (
  statLine: BatterFantasyStatLine,
  rules: DKClassicScoringRules
): number => {
  const hbpPoints = (statLine.projected_hbp ?? 0) * rules.batter.hbp;
  const csPoints = (statLine.projected_cs ?? 0) * rules.batter.caught_stealing;

  return round2(
    statLine.projected_singles * rules.batter.single +
    statLine.projected_doubles * rules.batter.double +
    statLine.projected_triples * rules.batter.triple +
    statLine.projected_hr * rules.batter.home_run +
    statLine.projected_rbi * rules.batter.rbi +
    statLine.projected_runs * rules.batter.run +
    statLine.projected_bb * rules.batter.walk +
    hbpPoints +
    statLine.projected_sb * rules.batter.stolen_base +
    csPoints
  );
};
