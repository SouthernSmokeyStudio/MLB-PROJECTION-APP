import { afterEach, describe, expect, it, vi } from "vitest";
import rawFixture from "../../data/fixtures/sample-raw-game.json";
import preparedFixture from "../../data/fixtures/sample-prepared-game.json";
import type { DraftKingsClassicSalarySlate } from "../../lib/contracts/draftkings-classic";
import type { PreparedGameInputs } from "../../lib/contracts/prepared";
import { asISOTimestamp, asPlayerId } from "../../lib/contracts/types";
import { parseMlbStatsApiGamePayload } from "../../lib/adapters/mlbStatsApi";
import {
  fetchDraftKingsClassicSalarySlate,
  parseDraftKingsClassicSalarySlate
} from "../../lib/adapters/draftKings";
import { normalizeMlbStatsApiGame } from "../../lib/normalization/mlbStatsApiNormalizer";
import { buildGameCard } from "../../lib/services/buildGameCard";
import { buildDfsEdgeBoard } from "../../lib/services/buildDfsEdgeBoard";
import {
  buildPlayerCards,
  type PlayerCard
} from "../../lib/services/buildPlayerCard";
import {
  buildDraftKingsClassicPlayerCards,
  joinDraftKingsClassicSalaries,
  normalizeNameForJoin
} from "../../lib/services/joinDraftKingsClassicSalaries";
import { indexCrosswalk } from "../../lib/crosswalk/resolvePlayerIdentity";
import type { PlayerCrosswalk, PlayerCrosswalkEntry } from "../../lib/contracts/player-crosswalk";
import { normalizeNameForJoin as normalizeNameCrosswalk } from "../../lib/crosswalk/normalize";

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

/**
 * Build a salary slate with explicit display names for name-based fallback tests.
 * Each entry gets a DK numeric player_id and the provided display_name.
 */
const makeSalarySlateWithNames = (
  entries: readonly { displayName: string; salary?: number; team?: string }[]
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
  salaries: entries.map((entry, index) => ({
    draftable_id: String(900000 + index),
    player_id: asPlayerId(String(700000 + index)),   // DK numeric ID — never matches a slug
    player_dk_id: String(800000 + index),
    display_name: entry.displayName,
    short_name: entry.displayName.split(" ").map((w, i) => i === 0 ? `${w[0]}.` : w).join(" "),
    position: index < 2 ? "SP" : "OF",
    roster_slot_id: index < 2 ? 110 : 200,
    salary: entry.salary ?? 5000 + index * 200,
    team_abbreviation: entry.team ?? (index % 2 === 0 ? "NYY" : "BOS"),
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

  // ---------------------------------------------------------------------------
  // Name-based fallback join (projected-tier DFS reconciliation repair)
  // ---------------------------------------------------------------------------

  describe("name-based fallback join", () => {
    it("normalizeNameForJoin: slug and display name converge to same key", () => {
      // Standard two-part name
      expect(normalizeNameForJoin("gerrit-cole")).toBe("gerritcole");
      expect(normalizeNameForJoin("Gerrit Cole")).toBe("gerritcole");

      // Three-part hyphenated name
      expect(normalizeNameForJoin("simeon-woods-richardson")).toBe("simeonwoodsrichardson");
      expect(normalizeNameForJoin("Simeon Woods Richardson")).toBe("simeonwoodsrichardson");

      // Periods in abbreviated names (A.J. Minter)
      expect(normalizeNameForJoin("A.J. Minter")).toBe("ajminter");
      expect(normalizeNameForJoin("a-j-minter")).toBe("ajminter");

      // Jr. suffix
      expect(normalizeNameForJoin("Ronald Acuña Jr.")).toBe("ronaldacunajr");
      expect(normalizeNameForJoin("ronald-acuna-jr")).toBe("ronaldacunajr");

      // Empty/whitespace → empty string
      expect(normalizeNameForJoin("")).toBe("");
      expect(normalizeNameForJoin("---")).toBe("");
    });

    it("projected slug player_id joins via name fallback when mlb_stats_api_id is null", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;

      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      const realBatter = realPlayers.find((p) => p.deterministic_summary?.kind === "batter");
      if (!realPitcher || !realBatter) {
        throw new Error("Fixture must produce at least one pitcher and one batter");
      }

      // Simulate projected-tier output: slug player_id, null mlb_stats_api_id
      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "gerrit-cole",
        mlb_stats_api_id: null
      };
      const batter: PlayerCard = {
        ...realBatter,
        player_id: "juan-soto",
        mlb_stats_api_id: null
      };

      // DK salary slate with numeric player_ids and real display names
      const salarySlate = makeSalarySlateWithNames([
        { displayName: "Gerrit Cole", salary: 10200, team: pitcher.team_id.toUpperCase() },
        { displayName: "Juan Soto", salary: 5800, team: batter.team_id.toUpperCase() }
      ]);

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

      // Both should be ready via name fallback
      expect(result.blocked.is_blocked).toBe(false);
      expect(result.ready_players).toBe(2);
      expect(result.held_players).toBe(0);

      const joinedPitcher = result.players.find((p) => p.player_id === "gerrit-cole");
      expect(joinedPitcher!.draftkings_classic.blocked.is_blocked).toBe(false);
      expect(joinedPitcher!.fantasy_summary?.salary).toBe(10200);

      const joinedBatter = result.players.find((p) => p.player_id === "juan-soto");
      expect(joinedBatter!.draftkings_classic.blocked.is_blocked).toBe(false);
      expect(joinedBatter!.fantasy_summary?.salary).toBe(5800);
    });

    it("MLB-backed batter joins by unique full-name and exact team when DK ID differs", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;
      const realBatter = realPlayers.find((p) => p.deterministic_summary?.kind === "batter");
      if (!realBatter) {
        throw new Error("Fixture must produce at least one batter");
      }

      const batter: PlayerCard = {
        ...realBatter,
        player_id: "656941",
        mlb_stats_api_id: "656941",
        team_id: "phi"
      };
      const salarySlate = makeSalarySlateWithNames([
        { displayName: "Kyle Schwarber", salary: 6000, team: "PHI" }
      ]);
      const dkSalarySlate: DraftKingsClassicSalarySlate = {
        ...salarySlate,
        salaries: salarySlate.salaries.map((entry) => ({
          ...entry,
          player_id: asPlayerId("709545")
        }))
      };

      const result = joinDraftKingsClassicSalaries({
        game: {
          ...game,
          away_team_id: "ari",
          home_team_id: "phi"
        },
        players: [batter],
        salary_slate: dkSalarySlate,
        salaryJoinIdentities: {
          "656941": {
            full_name: "Kyle Schwarber",
            team_abbreviation: "PHI"
          }
        }
      });

      expect(result.ready_players).toBe(1);
      expect(result.held_players).toBe(0);
      expect(result.players[0]!.draftkings_classic.blocked.is_blocked).toBe(false);
      expect(result.players[0]!.fantasy_summary?.salary).toBe(6000);
    });

    it("full-name fallback requires an exact team match", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;
      const realBatter = realPlayers.find((p) => p.deterministic_summary?.kind === "batter");
      if (!realBatter) {
        throw new Error("Fixture must produce at least one batter");
      }

      const batter: PlayerCard = {
        ...realBatter,
        player_id: "656941",
        mlb_stats_api_id: "656941",
        team_id: "phi"
      };
      const salarySlate = makeSalarySlateWithNames([
        { displayName: "Kyle Schwarber", salary: 6000, team: "NYY" }
      ]);
      const result = joinDraftKingsClassicSalaries({
        game: {
          ...game,
          away_team_id: "ari",
          home_team_id: "phi"
        },
        players: [batter],
        salary_slate: salarySlate,
        salaryJoinIdentities: {
          "656941": {
            full_name: "Kyle Schwarber",
            team_abbreviation: "PHI"
          }
        }
      });

      expect(result.ready_players).toBe(0);
      expect(result.held_players).toBe(1);
      expect(result.players[0]!.draftkings_classic.blocked.is_blocked).toBe(true);
      expect(result.players[0]!.fantasy_summary?.salary).toBeNull();
    });

    it("periods and hyphens normalize correctly for abbreviated names", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;

      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      if (!realPitcher) {
        throw new Error("Fixture must produce at least one pitcher");
      }

      // "A.J. Minter" in DK display vs "a-j-minter" from Rotowire slug
      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "a-j-minter",
        mlb_stats_api_id: null
      };

      const salarySlate = makeSalarySlateWithNames([
        { displayName: "A.J. Minter", salary: 6500 }
      ]);

      const testGame: typeof game = {
        ...game,
        away_team_id: pitcher.team_id,
        home_team_id: pitcher.team_id
      };

      const result = joinDraftKingsClassicSalaries({
        game: testGame,
        players: [pitcher],
        salary_slate: salarySlate
      });

      expect(result.ready_players).toBe(1);
      expect(result.held_players).toBe(0);

      const joined = result.players[0];
      expect(joined!.draftkings_classic.blocked.is_blocked).toBe(false);
      expect(joined!.fantasy_summary?.salary).toBe(6500);
    });

    it("no-match stays held when neither ID nor name matches", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;

      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      if (!realPitcher) {
        throw new Error("Fixture must produce at least one pitcher");
      }

      // Player slug that doesn't match any DK display_name
      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "nonexistent-player",
        mlb_stats_api_id: null
      };

      const salarySlate = makeSalarySlateWithNames([
        { displayName: "Gerrit Cole", salary: 10200 }
      ]);

      const testGame: typeof game = {
        ...game,
        away_team_id: pitcher.team_id,
        home_team_id: pitcher.team_id
      };

      const result = joinDraftKingsClassicSalaries({
        game: testGame,
        players: [pitcher],
        salary_slate: salarySlate
      });

      expect(result.ready_players).toBe(0);
      expect(result.held_players).toBe(1);

      const held = result.players[0];
      expect(held!.draftkings_classic.blocked.is_blocked).toBe(true);
      expect(held!.fantasy_summary?.salary).toBeNull();
    });

    it("primary ID join takes precedence over name fallback", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;

      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      if (!realPitcher) {
        throw new Error("Fixture must produce at least one pitcher");
      }

      // Player has mlb_stats_api_id that matches a DK player_id directly
      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "gerrit-cole",
        mlb_stats_api_id: "543037"
      };

      // Salary slate with numeric ID "543037" at salary 10200,
      // and display_name "Gerrit Cole" at a DIFFERENT salary (8000)
      const salarySlate: DraftKingsClassicSalarySlate = {
        provider: "draftkings",
        contest_type: "classic",
        draft_group_id: "145020",
        source: {
          provider: "draftkings",
          endpoint: "https://api.draftkings.com/draftgroups/v1/draftgroups/145020/draftables?format=json",
          fetched_at: asISOTimestamp("2026-04-06T17:00:00Z"),
          raw_payload_hash: null
        },
        salaries: [
          {
            draftable_id: "900001",
            player_id: asPlayerId("543037"),
            player_dk_id: "800001",
            display_name: "Different Player",
            short_name: "D. Player",
            position: "SP",
            roster_slot_id: 110,
            salary: 10200,
            team_abbreviation: "NYY",
            competition_id: "6157701",
            competition_name: "NYY @ BOS",
            competition_start: asISOTimestamp("2026-03-27T19:05:00Z")
          },
          {
            draftable_id: "900002",
            player_id: asPlayerId("999999"),
            player_dk_id: "800002",
            display_name: "Gerrit Cole",
            short_name: "G. Cole",
            position: "SP",
            roster_slot_id: 110,
            salary: 8000,
            team_abbreviation: "NYY",
            competition_id: "6157701",
            competition_name: "NYY @ BOS",
            competition_start: asISOTimestamp("2026-03-27T19:05:00Z")
          }
        ]
      };

      const testGame: typeof game = {
        ...game,
        away_team_id: pitcher.team_id,
        home_team_id: pitcher.team_id
      };

      const result = joinDraftKingsClassicSalaries({
        game: testGame,
        players: [pitcher],
        salary_slate: salarySlate
      });

      // Should match via mlb_stats_api_id → "543037" → salary 10200 (NOT the name match at 8000)
      expect(result.ready_players).toBe(1);
      const joined = result.players[0];
      expect(joined!.fantasy_summary?.salary).toBe(10200);
    });

    it("join-level proof: projected-tier pitchers with slug player_id and null mlb_stats_api_id produce ready_players > 0", () => {
      const playerCards = buildPlayerCards(prepared).players;

      // Fixture pitchers have unique slug player_ids ("gerrit-cole", "chris-sale").
      // Fixture batters have stub IDs ("nyy-1", "bos-1") which are NOT unique names —
      // "nyy-1" through "nyy-9" all normalize to "nyy" → correctly flagged ambiguous.
      // This test proves the projected-tier pitcher path: slug + null mlb_stats_api_id → name match.
      const pitcherCards = playerCards.filter(
        (p) => p.deterministic_summary?.kind === "pitcher"
      );
      expect(pitcherCards.length).toBeGreaterThanOrEqual(2);

      const projectedPitchers = pitcherCards.map((p) => ({
        ...p,
        mlb_stats_api_id: null
      }));

      const salarySlate = makeSalarySlateWithNames(
        projectedPitchers.map((p) => ({
          displayName: p.player_id
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")
        }))
      );

      const game = buildGameCard(prepared);
      const result = joinDraftKingsClassicSalaries({
        game,
        players: projectedPitchers,
        salary_slate: salarySlate
      });

      expect(result.ready_players).toBe(projectedPitchers.length);
      expect(result.held_players).toBe(0);
      expect(result.blocked.is_blocked).toBe(false);

      for (const player of result.players) {
        expect(player.draftkings_classic.blocked.is_blocked).toBe(false);
        expect(player.fantasy_summary?.salary).not.toBeNull();
      }
    });

    it("ambiguous name key holds the player instead of matching the wrong salary", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;

      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      if (!realPitcher) {
        throw new Error("Fixture must produce at least one pitcher");
      }

      // Projected-tier pitcher with slug player_id, no mlb_stats_api_id
      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "chris-martin",
        mlb_stats_api_id: null
      };

      // Two DK salary entries that normalize to the same name → ambiguous
      const salarySlate = makeSalarySlateWithNames([
        { displayName: "Chris Martin", salary: 6000, team: pitcher.team_id.toUpperCase() },
        { displayName: "Chris Martin", salary: 7500, team: pitcher.team_id.toUpperCase() }
      ]);

      const testGame: typeof game = {
        ...game,
        away_team_id: pitcher.team_id,
        home_team_id: pitcher.team_id
      };

      const result = joinDraftKingsClassicSalaries({
        game: testGame,
        players: [pitcher],
        salary_slate: salarySlate
      });

      // Must be HELD — not matched to either ambiguous entry
      expect(result.ready_players).toBe(0);
      expect(result.held_players).toBe(1);

      const held = result.players[0];
      expect(held!.draftkings_classic.blocked.is_blocked).toBe(true);
      expect(held!.fantasy_summary?.salary).toBeNull();
    });

    it("primary ID join bypasses ambiguous name fallback", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;

      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      if (!realPitcher) {
        throw new Error("Fixture must produce at least one pitcher");
      }

      // Pitcher has a direct mlb_stats_api_id match — should succeed even if name is ambiguous
      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "chris-martin",
        mlb_stats_api_id: "700000"    // matches first DK entry's player_id from makeSalarySlateWithNames
      };

      // Two DK entries normalize to same name → ambiguous, but primary ID join should win
      const salarySlate = makeSalarySlateWithNames([
        { displayName: "Chris Martin", salary: 6000, team: pitcher.team_id.toUpperCase() },
        { displayName: "Chris Martin", salary: 7500, team: pitcher.team_id.toUpperCase() }
      ]);

      const testGame: typeof game = {
        ...game,
        away_team_id: pitcher.team_id,
        home_team_id: pitcher.team_id
      };

      const result = joinDraftKingsClassicSalaries({
        game: testGame,
        players: [pitcher],
        salary_slate: salarySlate
      });

      // Primary ID join wins — matched to first entry at salary 6000
      expect(result.ready_players).toBe(1);
      expect(result.held_players).toBe(0);

      const joined = result.players[0];
      expect(joined!.draftkings_classic.blocked.is_blocked).toBe(false);
      expect(joined!.fantasy_summary?.salary).toBe(6000);
    });

    it("unambiguous name among other entries still matches", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;

      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      const realBatter = realPlayers.find((p) => p.deterministic_summary?.kind === "batter");
      if (!realPitcher || !realBatter) {
        throw new Error("Fixture must produce at least one pitcher and one batter");
      }

      // Two players: one with ambiguous name, one with unique name
      const ambiguousPlayer: PlayerCard = {
        ...realPitcher,
        player_id: "chris-martin",
        mlb_stats_api_id: null
      };
      const uniquePlayer: PlayerCard = {
        ...realBatter,
        player_id: "juan-soto",
        mlb_stats_api_id: null
      };

      const salarySlate = makeSalarySlateWithNames([
        { displayName: "Chris Martin", salary: 6000, team: ambiguousPlayer.team_id.toUpperCase() },
        { displayName: "Chris Martin", salary: 7500, team: ambiguousPlayer.team_id.toUpperCase() },
        { displayName: "Juan Soto", salary: 5800, team: uniquePlayer.team_id.toUpperCase() }
      ]);

      const testGame: typeof game = {
        ...game,
        away_team_id: ambiguousPlayer.team_id,
        home_team_id: uniquePlayer.team_id
      };

      const result = joinDraftKingsClassicSalaries({
        game: testGame,
        players: [ambiguousPlayer, uniquePlayer],
        salary_slate: salarySlate
      });

      // Ambiguous player held, unique player ready
      expect(result.ready_players).toBe(1);
      expect(result.held_players).toBe(1);

      const heldPlayer = result.players.find((p) => p.player_id === "chris-martin");
      expect(heldPlayer!.draftkings_classic.blocked.is_blocked).toBe(true);

      const readyPlayer = result.players.find((p) => p.player_id === "juan-soto");
      expect(readyPlayer!.draftkings_classic.blocked.is_blocked).toBe(false);
      expect(readyPlayer!.fantasy_summary?.salary).toBe(5800);
    });
  });

  // ---------------------------------------------------------------------------
  // DFS board-level proof: counts.matched_salaries
  // ---------------------------------------------------------------------------

  describe("DFS board-level proof", () => {
    // Build a LiveSlateSourceGame from the existing fixtures
    const parsedResult = parseMlbStatsApiGamePayload(rawFixture);
    if (!parsedResult.success) {
      throw new Error(parsedResult.error);
    }
    const normalizedResult = normalizeMlbStatsApiGame(parsedResult.data);
    if (!normalizedResult.success) {
      throw new Error(normalizedResult.error);
    }

    const sourceGame = {
      parsedGame: parsedResult.data,
      canonicalGame: normalizedResult.data,
      preparedGame: prepared,
      liveScoreState: {
        away_score: null,
        home_score: null,
        inning_number: null,
        inning_state: null as "top" | "middle" | "bottom" | "end" | null,
        is_live: false,
        is_final: false,
        display_state: "Scheduled"
      },
      playerIdentities: {}
    };

    const boardOptions = {
      source: "test",
      date: "2026-04-06",
      generated_at: "2026-04-06T17:00:00Z",
      counts: {
        fetched_raw: 1,
        parsed: 1,
        normalized: 1,
        prepared: 1,
        boxscore_enriched: 0
      },
      draftkings_classic: {
        draft_group_id: "145020",
        label: "Main",
        min_start_time: "2026-04-06T19:05:00Z",
        max_start_time: "2026-04-06T23:10:00Z",
        tags: ["mlb-main"]
      }
    };

    it("projected-tier name fallback lifts counts.matched_salaries above 0", () => {
      const playerCards = buildPlayerCards(prepared).players;
      const pitcherCards = playerCards.filter(
        (p) => p.deterministic_summary?.kind === "pitcher"
      );
      const batterCards = playerCards.filter(
        (p) => p.deterministic_summary?.kind === "batter"
      );
      expect(pitcherCards.length).toBeGreaterThanOrEqual(2);

      // Construct a hybrid salary slate that proves BOTH join paths:
      //  - Pitchers: DK numeric player_id (won't primary-match slug) + real display name → name fallback
      //  - Batters: DK player_id set to match batter's player_id → primary join
      // This mirrors the real projected-tier shape: pitchers from Rotowire (slug IDs),
      // batters still matched via primary ID from existing sources.
      const allEntries = [
        ...pitcherCards.map((p) => ({
          displayName: p.player_id
            .split("-")
            .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")
        })),
        ...batterCards.map((p) => ({
          displayName: `Batter ${p.player_id}`  // won't name-match; relies on primary ID
        }))
      ];

      const salarySlate = makeSalarySlateWithNames(allEntries);

      // Override batter entries' DK player_id to match their actual player_id (primary join)
      const hybridSalarySlate: DraftKingsClassicSalarySlate = {
        ...salarySlate,
        salaries: salarySlate.salaries.map((entry, i) => {
          if (i < pitcherCards.length) return entry; // pitcher: keep DK numeric ID → name fallback
          return { ...entry, player_id: asPlayerId(batterCards[i - pitcherCards.length]!.player_id) };
        })
      };

      const board = buildDfsEdgeBoard([sourceGame], {
        ...boardOptions,
        salary_slate: hybridSalarySlate
      });

      // THE critical assertion: counts.matched_salaries > 0 at the public summary layer
      expect(board.counts.matched_salaries).toBeGreaterThan(0);
      // Pitchers matched via name fallback + batters matched via primary ID = all players
      expect(board.counts.matched_salaries).toBe(playerCards.length);
      expect(board.summary.ready_players).toBe(playerCards.length);
    });

    it("ambiguous name entries produce held players and lower matched_salaries count", () => {
      const playerCards = buildPlayerCards(prepared).players;
      const pitcherCards = playerCards.filter(
        (p) => p.deterministic_summary?.kind === "pitcher"
      );
      const batterCards = playerCards.filter(
        (p) => p.deterministic_summary?.kind === "batter"
      );
      expect(pitcherCards.length).toBeGreaterThanOrEqual(2);

      // Use first pitcher's display name for TWO DK entries → ambiguous key
      const firstPitcher = pitcherCards[0]!;
      const ambiguousDisplayName = firstPitcher.player_id
        .split("-")
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      // Build entries: pitchers get real names, batters get unique non-matching names
      const pitcherEntries = pitcherCards.map((p) => ({
        displayName: p.player_id
          .split("-")
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      }));
      const batterEntries = batterCards.map((p) => ({
        displayName: `Batter ${p.player_id}`
      }));
      // Add duplicate that makes first pitcher's name ambiguous
      const duplicateEntry = { displayName: ambiguousDisplayName };

      const salarySlate = makeSalarySlateWithNames([
        ...pitcherEntries,
        ...batterEntries,
        duplicateEntry
      ]);

      // Override batter entries' DK player_id to match (primary join)
      const hybridSalarySlate: DraftKingsClassicSalarySlate = {
        ...salarySlate,
        salaries: salarySlate.salaries.map((entry, i) => {
          if (i < pitcherCards.length) return entry; // pitcher entries
          if (i >= pitcherCards.length + batterCards.length) return entry; // duplicate entry
          return { ...entry, player_id: asPlayerId(batterCards[i - pitcherCards.length]!.player_id) };
        })
      };

      const board = buildDfsEdgeBoard([sourceGame], {
        ...boardOptions,
        salary_slate: hybridSalarySlate
      });

      // First pitcher held (ambiguous name), rest matched
      // matched_salaries should be less than total players
      expect(board.counts.matched_salaries).toBeLessThan(playerCards.length);
      expect(board.counts.matched_salaries).toBe(playerCards.length - 1);
      expect(board.summary.held_players).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // S3: Crosswalk-driven salary join
  // ---------------------------------------------------------------------------

  describe("crosswalk-driven salary join", () => {
    const makeCrosswalkEntry = (
      overrides: Partial<PlayerCrosswalkEntry> & {
        canonical_player_id: string;
        mlb_stats_api_id: string;
        display_name: string;
        team_abbreviation: string;
      }
    ): PlayerCrosswalkEntry => ({
      normalized_name: normalizeNameCrosswalk(overrides.display_name),
      position: "P",
      throws: "R",
      seeded_at: "2026-04-10T00:00:00Z",
      dk_player_id: null,
      dk_player_dk_id: null,
      rotowire_slug: null,
      linked_at: null,
      linked_via: null,
      ...overrides
    });

    const makeCrosswalkFixture = (entries: PlayerCrosswalkEntry[]): PlayerCrosswalk => ({
      version: 1,
      generated_at: "2026-04-10T00:00:00Z",
      entry_count: entries.length,
      entries
    });

    /**
     * Build a salary slate where each entry's player_id is the DK player ID
     * (matching crosswalk.dk_player_id for linked entries).
     */
    const makeDkSalarySlate = (
      entries: readonly { dkPlayerId: string; salary: number; displayName: string; team: string }[]
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
      salaries: entries.map((e, i) => ({
        draftable_id: String(900000 + i),
        player_id: asPlayerId(e.dkPlayerId),
        player_dk_id: String(800000 + i),
        display_name: e.displayName,
        short_name: e.displayName.split(" ")[0]?.charAt(0) + ". " + (e.displayName.split(" ")[1] ?? ""),
        position: "SP",
        roster_slot_id: 110,
        salary: e.salary,
        team_abbreviation: e.team,
        competition_id: "6157701",
        competition_name: "NYY @ BOS",
        competition_start: asISOTimestamp("2026-03-27T19:05:00Z")
      }))
    });

    it("player resolved by mlb_stats_api_id with linked dk_player_id gets salary", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;
      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      if (!realPitcher) throw new Error("Need a pitcher");

      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "gerrit-cole",
        mlb_stats_api_id: "543037"
      };

      const crosswalk = indexCrosswalk(makeCrosswalkFixture([
        makeCrosswalkEntry({
          canonical_player_id: "mlb-543037",
          mlb_stats_api_id: "543037",
          display_name: "Gerrit Cole",
          team_abbreviation: "NYY",
          dk_player_id: "DK-COLE-99",
          linked_at: "2026-04-10T00:00:00Z",
          linked_via: "script-dk-salary-match"
        })
      ]));

      const salarySlate = makeDkSalarySlate([
        { dkPlayerId: "DK-COLE-99", salary: 10200, displayName: "Gerrit Cole", team: "NYY" }
      ]);

      const result = joinDraftKingsClassicSalaries({
        game: { ...game, away_team_id: pitcher.team_id, home_team_id: pitcher.team_id },
        players: [pitcher],
        salary_slate: salarySlate,
        crosswalk
      });

      expect(result.ready_players).toBe(1);
      expect(result.held_players).toBe(0);
      const joined = result.players[0]!;
      expect(joined.draftkings_classic.blocked.is_blocked).toBe(false);
      expect(joined.fantasy_summary?.salary).toBe(10200);
    });

    it("player resolved by dk_player_id gets salary", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;
      const realBatter = realPlayers.find((p) => p.deterministic_summary?.kind === "batter");
      if (!realBatter) throw new Error("Need a batter");

      // player_id IS the DK player ID (simulating DK-sourced flow)
      const batter: PlayerCard = {
        ...realBatter,
        player_id: "DK-JUDGE-77",
        mlb_stats_api_id: null
      };

      const crosswalk = indexCrosswalk(makeCrosswalkFixture([
        makeCrosswalkEntry({
          canonical_player_id: "mlb-592450",
          mlb_stats_api_id: "592450",
          display_name: "Aaron Judge",
          team_abbreviation: "NYY",
          dk_player_id: "DK-JUDGE-77",
          linked_at: "2026-04-10T00:00:00Z",
          linked_via: "script-dk-salary-match"
        })
      ]));

      const salarySlate = makeDkSalarySlate([
        { dkPlayerId: "DK-JUDGE-77", salary: 9500, displayName: "Aaron Judge", team: "NYY" }
      ]);

      const result = joinDraftKingsClassicSalaries({
        game: { ...game, away_team_id: batter.team_id, home_team_id: batter.team_id },
        players: [batter],
        salary_slate: salarySlate,
        crosswalk
      });

      expect(result.ready_players).toBe(1);
      expect(result.held_players).toBe(0);
      expect(result.players[0]!.fantasy_summary?.salary).toBe(9500);
    });

    it("player resolved by rotowire_slug gets salary only if crosswalk links to dk_player_id", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;
      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      if (!realPitcher) throw new Error("Need a pitcher");

      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "chris-sale",
        mlb_stats_api_id: null
      };

      // Crosswalk has rotowire_slug AND dk_player_id linked
      const crosswalk = indexCrosswalk(makeCrosswalkFixture([
        makeCrosswalkEntry({
          canonical_player_id: "mlb-519242",
          mlb_stats_api_id: "519242",
          display_name: "Chris Sale",
          team_abbreviation: "BOS",
          throws: "L",
          rotowire_slug: "chris-sale",
          dk_player_id: "DK-SALE-42",
          linked_at: "2026-04-10T00:00:00Z",
          linked_via: "script-dk-salary-match"
        })
      ]));

      const salarySlate = makeDkSalarySlate([
        { dkPlayerId: "DK-SALE-42", salary: 9800, displayName: "Chris Sale", team: "BOS" }
      ]);

      const result = joinDraftKingsClassicSalaries({
        game: { ...game, away_team_id: pitcher.team_id, home_team_id: pitcher.team_id },
        players: [pitcher],
        salary_slate: salarySlate,
        crosswalk
      });

      expect(result.ready_players).toBe(1);
      expect(result.players[0]!.fantasy_summary?.salary).toBe(9800);
    });

    it("resolved player with no dk_player_id link is held", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;
      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      if (!realPitcher) throw new Error("Need a pitcher");

      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "gerrit-cole",
        mlb_stats_api_id: "543037"
      };

      // Crosswalk resolves Cole but dk_player_id is null (not yet linked)
      const crosswalk = indexCrosswalk(makeCrosswalkFixture([
        makeCrosswalkEntry({
          canonical_player_id: "mlb-543037",
          mlb_stats_api_id: "543037",
          display_name: "Gerrit Cole",
          team_abbreviation: "NYY",
          dk_player_id: null
        })
      ]));

      const salarySlate = makeDkSalarySlate([
        { dkPlayerId: "DK-COLE-99", salary: 10200, displayName: "Unlinked Pitcher", team: "NYY" }
      ]);

      const result = joinDraftKingsClassicSalaries({
        game: { ...game, away_team_id: pitcher.team_id, home_team_id: pitcher.team_id },
        players: [pitcher],
        salary_slate: salarySlate,
        crosswalk
      });

      expect(result.ready_players).toBe(0);
      expect(result.held_players).toBe(1);
      expect(result.players[0]!.draftkings_classic.blocked.is_blocked).toBe(true);
      expect(result.players[0]!.draftkings_classic.blocked.blocked_reason).toContain("no dk_player_id link");
      expect(result.players[0]!.fantasy_summary?.salary).toBeNull();
    });

    it("unresolved player is held", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;
      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      if (!realPitcher) throw new Error("Need a pitcher");

      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "unknown-pitcher",
        mlb_stats_api_id: null
      };

      // Empty crosswalk — nobody resolves
      const crosswalk = indexCrosswalk(makeCrosswalkFixture([]));

      const salarySlate = makeDkSalarySlate([
        { dkPlayerId: "DK-999", salary: 5000, displayName: "Nobody", team: "NYY" }
      ]);

      const result = joinDraftKingsClassicSalaries({
        game: { ...game, away_team_id: pitcher.team_id, home_team_id: pitcher.team_id },
        players: [pitcher],
        salary_slate: salarySlate,
        crosswalk
      });

      expect(result.ready_players).toBe(0);
      expect(result.held_players).toBe(1);
      expect(result.players[0]!.draftkings_classic.blocked.is_blocked).toBe(true);
      expect(result.players[0]!.draftkings_classic.blocked.blocked_reason).toContain("unresolved");
      expect(result.players[0]!.fantasy_summary?.salary).toBeNull();
    });

    it("ambiguity remains fail-closed in crosswalk path", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;
      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      if (!realPitcher) throw new Error("Need a pitcher");

      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "will-smith",
        mlb_stats_api_id: null
      };

      // Two Will Smiths on LAD — ambiguous name+team composite
      const crosswalk = indexCrosswalk(makeCrosswalkFixture([
        makeCrosswalkEntry({
          canonical_player_id: "mlb-100001",
          mlb_stats_api_id: "100001",
          display_name: "Will Smith",
          team_abbreviation: "NYY",
          dk_player_id: "DK-WS-1"
        }),
        makeCrosswalkEntry({
          canonical_player_id: "mlb-100002",
          mlb_stats_api_id: "100002",
          display_name: "Will Smith",
          team_abbreviation: "NYY",
          dk_player_id: "DK-WS-2"
        })
      ]));

      const salarySlate = makeDkSalarySlate([
        { dkPlayerId: "DK-WS-1", salary: 5000, displayName: "Will Smith", team: "NYY" },
        { dkPlayerId: "DK-WS-2", salary: 6000, displayName: "Will Smith", team: "NYY" }
      ]);

      const result = joinDraftKingsClassicSalaries({
        game: { ...game, away_team_id: pitcher.team_id, home_team_id: pitcher.team_id },
        players: [pitcher],
        salary_slate: salarySlate,
        crosswalk
      });

      // Ambiguous — both name+team resolves to null (fail closed)
      expect(result.ready_players).toBe(0);
      expect(result.held_players).toBe(1);
      expect(result.players[0]!.draftkings_classic.blocked.is_blocked).toBe(true);
    });

    it("composite name+team-resolved player with linked dk_player_id gets salary", () => {
      const game = buildGameCard(prepared);
      const realPlayers = buildPlayerCards(prepared).players;
      const realPitcher = realPlayers.find((p) => p.deterministic_summary?.kind === "pitcher");
      if (!realPitcher) throw new Error("Need a pitcher");

      // Player has no mlb_stats_api_id, player_id is NOT a rotowire slug or dk_player_id.
      // The ONLY resolution path is composite name+team.
      const pitcher: PlayerCard = {
        ...realPitcher,
        player_id: "Gerrit Cole",
        mlb_stats_api_id: null
      };

      // Crosswalk entry: NO rotowire_slug, NO dk_player_id that matches player_id,
      // but the normalized name ("gerritcole") + team ("NYY") composite matches.
      const crosswalk = indexCrosswalk(makeCrosswalkFixture([
        makeCrosswalkEntry({
          canonical_player_id: "mlb-543037",
          mlb_stats_api_id: "543037",
          display_name: "Gerrit Cole",
          team_abbreviation: "NYY",
          rotowire_slug: null,
          dk_player_id: "DK-COLE-99",
          linked_at: "2026-04-10T00:00:00Z",
          linked_via: "script-dk-salary-match"
        })
      ]));

      const salarySlate = makeDkSalarySlate([
        { dkPlayerId: "DK-COLE-99", salary: 10200, displayName: "Gerrit Cole", team: "NYY" }
      ]);

      const result = joinDraftKingsClassicSalaries({
        game: { ...game, away_team_id: pitcher.team_id, home_team_id: pitcher.team_id },
        players: [pitcher],
        salary_slate: salarySlate,
        crosswalk
      });

      // Resolved via name+team composite → crosswalk entry has dk_player_id → salary matched
      expect(result.ready_players).toBe(1);
      expect(result.held_players).toBe(0);
      const joined = result.players[0]!;
      expect(joined.draftkings_classic.blocked.is_blocked).toBe(false);
      expect(joined.fantasy_summary?.salary).toBe(10200);
    });
  });
});
