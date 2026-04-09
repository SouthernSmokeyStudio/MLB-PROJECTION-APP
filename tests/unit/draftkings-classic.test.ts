import { afterEach, describe, expect, it, vi } from "vitest";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type { DraftKingsClassicSalarySlate } from "../../lib/contracts/draftkings-classic";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { asISOTimestamp, asPlayerId } from "../../lib/contracts/types";
import {
  fetchDraftKingsClassicSalarySlate,
  parseDraftKingsClassicSalarySlate
} from "../../lib/adapters/draftKings";
import { buildGameCard } from "../../lib/services/buildGameCard";
import {
  buildPlayerCards,
  type PlayerCard
} from "../../lib/services/buildPlayerCard";
import {
  buildDraftKingsClassicPlayerCards,
  joinDraftKingsClassicSalaries
} from "../../lib/services/joinDraftKingsClassicSalaries";

const prepared = preparedFixture as unknown as PreparedGameInputs;

const OFFICIAL_DRAFTABLE_PAYLOAD = {
  draftables: [
    {
      draftableId: 42538654,
      firstName: "Tarik",
      lastName: "Skubal",
      displayName: "Tarik Skubal",
      shortName: "T. Skubal",
      playerId: 1055775,
      playerDkId: 459787,
      position: "SP",
      rosterSlotId: 110,
      salary: 10200,
      status: "None",
      isSwappable: true,
      isDisabled: false,
      newsStatus: "Breaking",
      playerImage50: "https://dkn.gs/sports/images/mlb/players/50/459787.png",
      playerImage160: "https://dkn.gs/sports/images/mlb/players/160/459787.png",
      altPlayerImage50: "",
      altPlayerImage160: "",
      competition: {
        competitionId: 6157701,
        name: "DET @ MIN",
        startTime: "2026-04-06T23:40:00.0000000Z"
      },
      teamAbbreviation: "DET"
    }
  ]
} as const;

const makeSalarySlate = (
  playerIds: readonly string[]
): DraftKingsClassicSalarySlate => ({
  provider: "draftkings",
  contest_type: "classic",
  draft_group_id: "145020",
  source: {
    provider: "draftkings",
    endpoint: "https://api.draftkings.com/draftgroups/v1/draftgroups/145020/draftables?format=json",
    fetched_at: asISOTimestamp("2026-04-06T17:00:00Z"),
    raw_payload_hash: null
  },
  salaries: playerIds.map((playerId, index) => ({
    draftable_id: String(900000 + index),
    player_id: asPlayerId(playerId),
    player_dk_id: String(800000 + index),
    display_name: `Player ${index + 1}`,
    short_name: `P${index + 1}`,
    position: index < 2 ? "SP" : "OF",
    roster_slot_id: index < 2 ? 110 : 200,
    salary: 5000 + index * 200,
    team_abbreviation: index % 2 === 0 ? "NYY" : "BOS",
    competition_id: "6157701",
    competition_name: "NYY @ BOS",
    competition_start: asISOTimestamp("2026-03-27T19:05:00Z")
  }))
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DraftKings Classic salary join", () => {
  it("parses the official DraftKings Classic salary payload into the repo contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => OFFICIAL_DRAFTABLE_PAYLOAD
    });

    vi.stubGlobal("fetch", fetchMock);

    const loaded = await fetchDraftKingsClassicSalarySlate("145020");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.draftkings.com/draftgroups/v1/draftgroups/145020/draftables?format=json",
      expect.objectContaining({
        method: "GET",
        cache: "no-store"
      })
    );
    expect(loaded.success).toBe(true);

    if (!loaded.success) {
      throw new Error(loaded.error);
    }

    expect(loaded.data.provider).toBe("draftkings");
    expect(loaded.data.contest_type).toBe("classic");
    expect(loaded.data.salaries[0]?.player_id).toBe("1055775");
    expect(loaded.data.salaries[0]?.salary).toBe(10200);
  });

  it("attaches non-null DraftKings Classic salary and value when the join succeeds", () => {
    const playerCards = buildPlayerCards(prepared).players;
    // BF-003: salary slate must use mlb_stats_api_id for pitchers (numeric DK IDs)
    const salarySlate = makeSalarySlate(playerCards.map((player) => player.mlb_stats_api_id ?? player.player_id));
    const joined = buildDraftKingsClassicPlayerCards(prepared, salarySlate);

    expect(joined.blocked.is_blocked).toBe(false);
    expect(joined.ready_players).toBe(playerCards.length);
    expect(joined.held_players).toBe(0);

    const first = joined.players[0];
    expect(first).toBeDefined();

    if (!first?.fantasy_summary) {
      throw new Error("Expected a fantasy summary for successful salary join");
    }

    expect(first.draftkings_classic.blocked.is_blocked).toBe(false);
    expect(first.fantasy_summary.salary).not.toBeNull();
    expect(first.fantasy_summary.value).toBeCloseTo(
      first.fantasy_summary.projected_points / ((first.fantasy_summary.salary ?? 1) / 1000)
    );
  });

  it("keeps a player row held when the DraftKings Classic salary join fails", () => {
    const playerCards = buildPlayerCards(prepared).players;
    const missingSalaryPlayerId = playerCards[0]?.player_id;

    if (!missingSalaryPlayerId) {
      throw new Error("Expected at least one player card");
    }

    // BF-003: salary slate must use mlb_stats_api_id for pitchers (numeric DK IDs)
    const salarySlate = makeSalarySlate(
      playerCards.slice(1).map((player) => player.mlb_stats_api_id ?? player.player_id)
    );
    const joined = buildDraftKingsClassicPlayerCards(prepared, salarySlate);
    const heldPlayer = joined.players.find(
      (player) => player.player_id === missingSalaryPlayerId
    );
    const readyPlayer = joined.players.find(
      (player) => player.player_id !== missingSalaryPlayerId
    );

    expect(joined.held_players).toBeGreaterThan(0);
    expect(heldPlayer?.draftkings_classic.blocked.is_blocked).toBe(true);
    expect(heldPlayer?.fantasy_summary?.salary).toBeNull();
    expect(heldPlayer?.fantasy_summary?.value).toBeNull();
    expect(readyPlayer?.draftkings_classic.blocked.is_blocked).toBe(false);
    expect(readyPlayer?.fantasy_summary?.salary).not.toBeNull();
  });

  it("holds every row when the upstream chain fails reconciliation before salary join", () => {
    const game = buildGameCard(prepared);
    const players = buildPlayerCards(prepared).players;
    // BF-003: salary slate must use mlb_stats_api_id for pitchers (numeric DK IDs)
    const salarySlate = makeSalarySlate(players.map((player) => player.mlb_stats_api_id ?? player.player_id));
    const firstPlayer = players[0];

    if (!firstPlayer) {
      throw new Error("Expected at least one player card");
    }

    const brokenPlayers: PlayerCard[] = [
      { ...firstPlayer, team_id: "lad" },
      ...players.slice(1)
    ];
    const joined = joinDraftKingsClassicSalaries({
      game,
      players: brokenPlayers,
      salary_slate: salarySlate
    });

    expect(joined.blocked.is_blocked).toBe(true);
    expect(joined.ready_players).toBe(0);
    expect(joined.players.every((player) => player.draftkings_classic.blocked.is_blocked)).toBe(
      true
    );
  });

  // ---------------------------------------------------------------------------
  // BF-003: mlb_stats_api_id crosswalk for DraftKings salary join
  // ---------------------------------------------------------------------------

  it("BF-003: joins pitcher via mlb_stats_api_id when player_id is slugified", () => {
    const playerCards = buildPlayerCards(prepared).players;

    // Pitchers have slugified player_id ("gerrit-cole") but numeric mlb_stats_api_id ("543037")
    const pitcherCards = playerCards.filter(
      (p) => p.deterministic_summary?.kind === "pitcher"
    );
    expect(pitcherCards.length).toBeGreaterThanOrEqual(2);

    // Build salary slate using mlb_stats_api_id (numeric) for pitchers,
    // and player_id (already numeric in fixture) for batters
    const salaryIds = playerCards.map((p) => p.mlb_stats_api_id ?? p.player_id);
    const salarySlate = makeSalarySlate(salaryIds);
    const joined = buildDraftKingsClassicPlayerCards(prepared, salarySlate);

    // Every player should be ready — the crosswalk resolves the mismatch
    expect(joined.blocked.is_blocked).toBe(false);
    expect(joined.held_players).toBe(0);
    expect(joined.ready_players).toBe(playerCards.length);

    // Verify pitchers specifically are ready (not held)
    const joinedPitchers = joined.players.filter(
      (p) => p.deterministic_summary?.kind === "pitcher"
    );
    for (const pitcher of joinedPitchers) {
      expect(pitcher.draftkings_classic.blocked.is_blocked).toBe(false);
      expect(pitcher.fantasy_summary?.salary).not.toBeNull();
    }
  });

  it("BF-003: pitchers with slugified player_id are held when salary slate only has player_id keys (no crosswalk)", () => {
    const playerCards = buildPlayerCards(prepared).players;

    // Build salary slate using ONLY player_id — pitchers with slugified IDs won't match
    // because DK uses numeric IDs in production
    const pitcherCards = playerCards.filter(
      (p) => p.deterministic_summary?.kind === "pitcher"
    );
    const batterCards = playerCards.filter(
      (p) => p.deterministic_summary?.kind === "batter"
    );

    // Verify fixture pitchers have different player_id vs mlb_stats_api_id
    for (const pitcher of pitcherCards) {
      expect(pitcher.mlb_stats_api_id).not.toBeNull();
      expect(pitcher.mlb_stats_api_id).not.toBe(pitcher.player_id);
    }

    // Salary slate keyed by numeric IDs (what DK actually provides)
    const numericSalaryIds = playerCards.map((p) => p.mlb_stats_api_id ?? p.player_id);
    const salarySlate = makeSalarySlate(numericSalaryIds);

    // Simulate what would happen WITHOUT the crosswalk by directly calling
    // joinDraftKingsClassicSalaries with modified player cards that have no mlb_stats_api_id
    const strippedPlayers = playerCards.map((p) => ({
      ...p,
      mlb_stats_api_id: null
    }));
    const game = buildGameCard(prepared);
    const joinedWithoutCrosswalk = joinDraftKingsClassicSalaries({
      game,
      players: strippedPlayers,
      salary_slate: salarySlate
    });

    // Pitchers should be held because "gerrit-cole" !== "543037"
    const heldPitchers = joinedWithoutCrosswalk.players.filter(
      (p) =>
        p.deterministic_summary?.kind === "pitcher" &&
        p.draftkings_classic.blocked.is_blocked
    );
    expect(heldPitchers).toHaveLength(pitcherCards.length);

    // Batters should still be ready because their player_id is already the join key
    const readyBatters = joinedWithoutCrosswalk.players.filter(
      (p) =>
        p.deterministic_summary?.kind === "batter" &&
        !p.draftkings_classic.blocked.is_blocked
    );
    expect(readyBatters).toHaveLength(batterCards.length);
  });

  it("BF-003: pitcher with null mlb_stats_api_id falls back to player_id for join", () => {
    const playerCards = buildPlayerCards(prepared).players;

    // Strip mlb_stats_api_id from all players
    const strippedPlayers = playerCards.map((p) => ({
      ...p,
      mlb_stats_api_id: null
    }));

    // Build salary slate using player_id (slugified for pitchers)
    const salarySlate = makeSalarySlate(strippedPlayers.map((p) => p.player_id));
    const game = buildGameCard(prepared);
    const joined = joinDraftKingsClassicSalaries({
      game,
      players: strippedPlayers,
      salary_slate: salarySlate
    });

    // Falls back to player_id match — all should join
    expect(joined.blocked.is_blocked).toBe(false);
    expect(joined.held_players).toBe(0);
    expect(joined.ready_players).toBe(strippedPlayers.length);
  });

  it("BF-003: batter join still works unchanged via player_id", () => {
    const playerCards = buildPlayerCards(prepared).players;
    const batterCards = playerCards.filter(
      (p) => p.deterministic_summary?.kind === "batter"
    );

    // Batters should have null mlb_stats_api_id (field is pitcher-only metadata)
    for (const batter of batterCards) {
      expect(batter.mlb_stats_api_id).toBeNull();
    }

    // Build salary slate with mlb_stats_api_id for pitchers, player_id for batters
    const salaryIds = playerCards.map((p) => p.mlb_stats_api_id ?? p.player_id);
    const salarySlate = makeSalarySlate(salaryIds);
    const joined = buildDraftKingsClassicPlayerCards(prepared, salarySlate);

    const readyBatters = joined.players.filter(
      (p) =>
        p.deterministic_summary?.kind === "batter" &&
        !p.draftkings_classic.blocked.is_blocked
    );
    expect(readyBatters).toHaveLength(batterCards.length);

    for (const batter of readyBatters) {
      expect(batter.fantasy_summary?.salary).not.toBeNull();
    }
  });

  // ---------------------------------------------------------------------------
  // BF-003 direct join-path proof: joinDraftKingsClassicSalaries with
  // hand-crafted mixed-format player IDs
  // ---------------------------------------------------------------------------

  it("BF-003 join-path proof: pitcher player_id='gerrit-cole' + mlb_stats_api_id='543037' joins to DK salary keyed '543037'", () => {
    // Build real game card and player cards from the fixture, then replace IDs
    // to create the exact mixed-format mismatch scenario.
    const game = buildGameCard(prepared);
    const realPlayers = buildPlayerCards(prepared).players;

    // Identify the real pitcher and batter from the fixture output
    const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
    const realBatter = realPlayers.find((p) => p.deterministic_summary?.kind === "batter");
    if (!realPitcher || !realBatter) {
      throw new Error("Fixture must produce at least one pitcher and one batter");
    }

    // Hand-craft PlayerCards with explicit controlled IDs:
    //  - pitcher: slugified player_id, numeric mlb_stats_api_id
    //  - batter: fixture player_id, null mlb_stats_api_id
    const pitcher: PlayerCard = {
      ...realPitcher,
      player_id: "gerrit-cole",          // slugified canonical ID
      mlb_stats_api_id: "543037"         // numeric MLB Stats API ID
    };
    const batter: PlayerCard = {
      ...realBatter,
      player_id: "nyy-1",               // fixture batter ID
      mlb_stats_api_id: null             // batters have no auxiliary ID
    };

    // DK salary slate keyed by numeric IDs — exactly what DK provides in production
    const salarySlate = makeSalarySlate(["543037", "nyy-1"]);

    // Reconciliation needs player team membership to be valid,
    // so use a game card matching the players' teams
    const testGame: typeof game = {
      ...game,
      away_team_id: pitcher.team_id,
      home_team_id: batter.team_id
    };

    const result = joinDraftKingsClassicSalaries({
      game: testGame,
      players: [pitcher, batter],
      salary_slate: salarySlate
    });

    // CORE ASSERTION: the join must NOT be blocked
    expect(result.blocked.is_blocked).toBe(false);
    expect(result.ready_players).toBe(2);
    expect(result.held_players).toBe(0);

    // Pitcher joined via mlb_stats_api_id crosswalk
    const joinedPitcher = result.players.find((p) => p.player_id === "gerrit-cole");
    expect(joinedPitcher).toBeDefined();
    expect(joinedPitcher!.draftkings_classic.blocked.is_blocked).toBe(false);
    expect(joinedPitcher!.fantasy_summary?.salary).toBe(5000); // first salary entry

    // Batter joined via player_id fallback (mlb_stats_api_id is null)
    const joinedBatter = result.players.find((p) => p.player_id === "nyy-1");
    expect(joinedBatter).toBeDefined();
    expect(joinedBatter!.draftkings_classic.blocked.is_blocked).toBe(false);
    expect(joinedBatter!.fantasy_summary?.salary).toBe(5200); // second salary entry
  });

  it("BF-003 negative control: without mlb_stats_api_id, pitcher player_id='gerrit-cole' CANNOT join to DK salary keyed '543037'", () => {
    const game = buildGameCard(prepared);
    const realPlayers = buildPlayerCards(prepared).players;

    const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
    const realBatter = realPlayers.find((p) => p.deterministic_summary?.kind === "batter");
    if (!realPitcher || !realBatter) {
      throw new Error("Fixture must produce at least one pitcher and one batter");
    }

    // Same setup, but pitcher has NO mlb_stats_api_id
    const pitcher: PlayerCard = {
      ...realPitcher,
      player_id: "gerrit-cole",
      mlb_stats_api_id: null               // crosswalk stripped
    };
    const batter: PlayerCard = {
      ...realBatter,
      player_id: "nyy-1",
      mlb_stats_api_id: null
    };

    // DK salary slate still keyed by numeric IDs
    const salarySlate = makeSalarySlate(["543037", "nyy-1"]);

    const testGame: typeof game = {
      ...game,
      away_team_id: pitcher.team_id,
      home_team_id: batter.team_id
    };

    const result = joinDraftKingsClassicSalaries({
      game: testGame,
      players: [pitcher, batter],
      salary_slate: salarySlate
    });

    // Pitcher HELD: "gerrit-cole" cannot match "543037" without crosswalk
    const joinedPitcher = result.players.find((p) => p.player_id === "gerrit-cole");
    expect(joinedPitcher).toBeDefined();
    expect(joinedPitcher!.draftkings_classic.blocked.is_blocked).toBe(true);
    expect(joinedPitcher!.fantasy_summary?.salary).toBeNull();

    // Batter READY: "nyy-1" matches "nyy-1" via player_id fallback
    const joinedBatter = result.players.find((p) => p.player_id === "nyy-1");
    expect(joinedBatter).toBeDefined();
    expect(joinedBatter!.draftkings_classic.blocked.is_blocked).toBe(false);
    expect(joinedBatter!.fantasy_summary?.salary).toBe(5200);

    // One held (pitcher), one ready (batter)
    expect(result.held_players).toBe(1);
    expect(result.ready_players).toBe(1);
  });

  it("parses the pure salary contract without fetch-side invention", () => {
    const parsed = parseDraftKingsClassicSalarySlate({
      draftGroupId: "145020",
      fetchedAt: asISOTimestamp("2026-04-06T17:00:00Z"),
      payload: OFFICIAL_DRAFTABLE_PAYLOAD
    });

    expect(parsed.success).toBe(true);

    if (!parsed.success) {
      throw new Error(parsed.error);
    }

    expect(parsed.data.salaries).toHaveLength(1);
    expect(parsed.data.salaries[0]?.competition_name).toBe("DET @ MIN");
  });
});
