import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DraftKingsClassicDraftGroup,
  DraftKingsClassicSalarySlate
} from "../../lib/contracts/draftkings-classic";
import { asISOTimestamp, asPlayerId } from "../../lib/contracts/types";

vi.mock("@lib/adapters/draftKings", () => ({
  fetchDraftKingsClassicSalarySlate: vi.fn(),
  fetchUpcomingDraftKingsClassicDraftGroups: vi.fn()
}));

import {
  fetchDraftKingsClassicSalarySlate,
  fetchUpcomingDraftKingsClassicDraftGroups
} from "@lib/adapters/draftKings";
import { loadDraftKingsClassicSlate } from "../../lib/services/loadDraftKingsClassicSlate";

const makeDraftGroup = (
  overrides: Partial<DraftKingsClassicDraftGroup> = {}
): DraftKingsClassicDraftGroup => ({
  draft_group_id: "145340",
  sport_id: 2,
  contest_type_id: 28,
  game_type_id: 2,
  draft_group_state: "Released",
  sort_order: 1,
  start_time_suffix: " Main",
  min_start_time: asISOTimestamp("2026-04-10T23:05:00Z"),
  max_start_time: asISOTimestamp("2026-04-11T02:30:00Z"),
  allow_lineup_creation: true,
  all_tags: ["Featured"],
  competition_ids: ["6157701"],
  ...overrides
});

const makeSalarySlate = (
  draftGroupId = "145340"
): DraftKingsClassicSalarySlate => ({
  provider: "draftkings",
  contest_type: "classic",
  draft_group_id: draftGroupId,
  source: {
    provider: "draftkings",
    endpoint: `https://api.draftkings.com/draftgroups/v1/draftgroups/${draftGroupId}/draftables?format=json`,
    fetched_at: asISOTimestamp("2026-04-10T18:00:00Z"),
    raw_payload_hash: null
  },
  salaries: [
    {
      draftable_id: "900001",
      player_id: asPlayerId("700001"),
      player_dk_id: "800001",
      display_name: "Test Player",
      short_name: "T. Player",
      position: "OF",
      roster_slot_id: 200,
      salary: 4300,
      team_abbreviation: "NYY",
      competition_id: "6157701",
      competition_name: "NYY @ BOS",
      competition_start: asISOTimestamp("2026-04-10T23:05:00Z")
    }
  ]
});

describe("loadDraftKingsClassicSlate persistence fallback", () => {
  let artifactDir: string;

  beforeEach(async () => {
    artifactDir = await mkdtemp(join(tmpdir(), "dk-classic-"));
    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockReset();
    vi.mocked(fetchDraftKingsClassicSalarySlate).mockReset();
  });

  afterEach(async () => {
    await rm(artifactDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("uses the live upcoming slate when available and persists it by requested app date", async () => {
    const draftGroup = makeDraftGroup();
    const salarySlate = makeSalarySlate();
    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockResolvedValue(
      { success: true, data: [draftGroup] }
    );
    vi.mocked(fetchDraftKingsClassicSalarySlate).mockResolvedValue(
      { success: true, data: salarySlate }
    );

    const loaded = await loadDraftKingsClassicSlate({
      date: "2026-04-10",
      artifactDir
    });

    expect(loaded.success).toBe(true);
    if (!loaded.success) throw new Error(loaded.error);
    expect(loaded.data.source).toBe("draftkings-classic-live");
    expect(loaded.data.draft_group?.draft_group_id).toBe("145340");
    expect(loaded.data.salary_slate?.draft_group_id).toBe("145340");
    expect(fetchDraftKingsClassicSalarySlate).toHaveBeenCalledWith("145340");

    const persistedRaw = await readFile(join(artifactDir, "2026-04-10.json"), "utf-8");
    const persisted = JSON.parse(persistedRaw) as {
      readonly date?: string;
      readonly draft_group?: { readonly draft_group_id?: string };
      readonly salary_slate?: { readonly draft_group_id?: string };
    };

    expect(persisted.date).toBe("2026-04-10");
    expect(persisted.draft_group?.draft_group_id).toBe("145340");
    expect(persisted.salary_slate?.draft_group_id).toBe("145340");
  });

  it("uses live upcoming instead of stale persisted data when both exist for the requested date", async () => {
    const persistedGroup = makeDraftGroup({ draft_group_id: "145340" });
    const liveGroup = makeDraftGroup({
      draft_group_id: "145999",
      sort_order: 0
    });
    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockResolvedValueOnce(
      { success: true, data: [persistedGroup] }
    );
    vi.mocked(fetchDraftKingsClassicSalarySlate).mockResolvedValueOnce(
      { success: true, data: makeSalarySlate("145340") }
    );
    const seeded = await loadDraftKingsClassicSlate({
      date: "2026-04-10",
      artifactDir
    });
    expect(seeded.success).toBe(true);

    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockResolvedValueOnce(
      { success: true, data: [liveGroup] }
    );
    vi.mocked(fetchDraftKingsClassicSalarySlate).mockResolvedValueOnce(
      { success: true, data: makeSalarySlate("145999") }
    );

    const loaded = await loadDraftKingsClassicSlate({
      date: "2026-04-10",
      artifactDir
    });

    expect(loaded.success).toBe(true);
    if (!loaded.success) throw new Error(loaded.error);
    expect(loaded.data.source).toBe("draftkings-classic-live");
    expect(loaded.data.draft_group?.draft_group_id).toBe("145999");
    expect(loaded.data.salary_slate?.draft_group_id).toBe("145999");
    expect(fetchUpcomingDraftKingsClassicDraftGroups).toHaveBeenCalledTimes(2);
    expect(fetchDraftKingsClassicSalarySlate).toHaveBeenCalledTimes(2);

    const persistedRaw = await readFile(join(artifactDir, "2026-04-10.json"), "utf-8");
    const persisted = JSON.parse(persistedRaw) as {
      readonly draft_group?: { readonly draft_group_id?: string };
      readonly salary_slate?: { readonly draft_group_id?: string };
    };
    expect(persisted.draft_group?.draft_group_id).toBe("145999");
    expect(persisted.salary_slate?.draft_group_id).toBe("145999");
  });

  it("uses the persisted date-keyed slate after the upcoming source rotates away", async () => {
    const draftGroup = makeDraftGroup();
    const salarySlate = makeSalarySlate();
    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockResolvedValueOnce(
      { success: true, data: [draftGroup] }
    );
    vi.mocked(fetchDraftKingsClassicSalarySlate).mockResolvedValueOnce(
      { success: true, data: salarySlate }
    );

    const seeded = await loadDraftKingsClassicSlate({
      date: "2026-04-10",
      artifactDir
    });
    expect(seeded.success).toBe(true);

    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockResolvedValueOnce(
      {
        success: true,
        data: [
          makeDraftGroup({
            draft_group_id: "145500",
            min_start_time: asISOTimestamp("2026-04-11T23:05:00Z")
          })
        ]
      }
    );
    vi.mocked(fetchDraftKingsClassicSalarySlate).mockResolvedValueOnce({
      success: false,
      error: "should not fetch live salary when persisted artifact exists"
    });

    const loaded = await loadDraftKingsClassicSlate({
      date: "2026-04-10",
      artifactDir
    });

    expect(loaded.success).toBe(true);
    if (!loaded.success) throw new Error(loaded.error);
    expect(loaded.data.source).toBe("draftkings-classic-persisted");
    expect(loaded.data.draft_group?.draft_group_id).toBe("145340");
    expect(loaded.data.salary_slate?.draft_group_id).toBe("145340");
    expect(fetchUpcomingDraftKingsClassicDraftGroups).toHaveBeenCalledTimes(2);
    expect(fetchDraftKingsClassicSalarySlate).toHaveBeenCalledTimes(1);
  });

  it("returns a held slate only when neither persisted nor live upcoming can provide the requested date", async () => {
    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockResolvedValue(
      {
        success: true,
        data: [
          makeDraftGroup({
            draft_group_id: "145500",
            min_start_time: asISOTimestamp("2026-04-11T23:05:00Z")
          })
        ]
      }
    );

    const loaded = await loadDraftKingsClassicSlate({
      date: "2026-04-10",
      artifactDir
    });

    expect(loaded.success).toBe(true);
    if (!loaded.success) throw new Error(loaded.error);
    expect(loaded.data.draft_group).toBeNull();
    expect(loaded.data.salary_slate).toBeNull();
    expect(loaded.data.note).toContain(
      "No DraftKings Classic salary slate matched the requested date."
    );
    expect(fetchDraftKingsClassicSalarySlate).not.toHaveBeenCalled();
  });
});
