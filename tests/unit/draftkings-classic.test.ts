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
    const salarySlate = makeSalarySlate(playerCards.map((player) => player.player_id));
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

    const salarySlate = makeSalarySlate(
      playerCards.slice(1).map((player) => player.player_id)
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
    const salarySlate = makeSalarySlate(players.map((player) => player.player_id));
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
