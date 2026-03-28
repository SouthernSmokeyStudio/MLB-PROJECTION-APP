export interface DKClassicScoringRules {
  readonly version: string;
  readonly platform: "draftkings";
  readonly contest_type: "classic";
  readonly batter: {
    readonly single: number;
    readonly double: number;
    readonly triple: number;
    readonly home_run: number;
    readonly rbi: number;
    readonly run: number;
    readonly walk: number;
    readonly hbp: number;
    readonly stolen_base: number;
    readonly caught_stealing: number;
  };
  readonly pitcher: {
    readonly inning_pitched: number;
    readonly strikeout: number;
    readonly win: number;
    readonly earned_run: number;
    readonly hit: number;
    readonly walk: number;
    readonly hbp: number;
    readonly complete_game: number;
    readonly shutout: number;
    readonly no_hitter: number;
  };
}

export const DK_CLASSIC_RULES_V1: DKClassicScoringRules = {
  version: "dk_classic_v1",
  platform: "draftkings",
  contest_type: "classic",
  batter: {
    single: 3,
    double: 5,
    triple: 8,
    home_run: 10,
    rbi: 2,
    run: 2,
    walk: 2,
    hbp: 2,
    stolen_base: 5,
    caught_stealing: -2
  },
  pitcher: {
    inning_pitched: 2.25,
    strikeout: 2,
    win: 4,
    earned_run: -2,
    hit: -0.6,
    walk: -0.6,
    hbp: -0.6,
    complete_game: 2.5,
    shutout: 2.5,
    no_hitter: 5
  }
};

export const ipToOuts = (ip: number): number => {
  const fullInnings = Math.floor(ip);
  const partialOuts = Math.round((ip - fullInnings) * 10);
  return fullInnings * 3 + partialOuts;
};

export const outsToIp = (outs: number): number => {
  const fullInnings = Math.floor(outs / 3);
  const partialOuts = outs % 3;
  return fullInnings + partialOuts / 10;
};
