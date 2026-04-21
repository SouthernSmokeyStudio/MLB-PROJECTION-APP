import { access, mkdtemp, readFile, rm } from "node:fs/promises";
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
import {
  backfillDraftKingsClassicSlate,
  loadDraftKingsClassicSlate
} from "../../lib/services/loadDraftKingsClassicSlate";

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

describe("backfillDraftKingsClassicSlate", () => {
  let artifactDir: string;

  beforeEach(async () => {
    artifactDir = await mkdtemp(join(tmpdir(), "dk-classic-backfill-"));
    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockReset();
    vi.mocked(fetchDraftKingsClassicSalarySlate).mockReset();
  });

  afterEach(async () => {
    await rm(artifactDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("writes a version-2 multi-slate artifact keyed by requested date when matching same-date groups exist", async () => {
    const draftGroupA = makeDraftGroup({ draft_group_id: "145340", sort_order: 1 });
    const draftGroupB = makeDraftGroup({ draft_group_id: "145341", sort_order: 2 });

    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockResolvedValue({
      success: true,
      data: [draftGroupA, draftGroupB]
    });
    vi.mocked(fetchDraftKingsClassicSalarySlate)
      .mockResolvedValueOnce({ success: true, data: makeSalarySlate("145340") })
      .mockResolvedValueOnce({ success: true, data: makeSalarySlate("145341") });

    const result = await backfillDraftKingsClassicSlate({
      date: "2026-04-10",
      artifactDir
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.slates).toHaveLength(2);

    const persistedRaw = await readFile(join(artifactDir, "2026-04-10.json"), "utf-8");
    const persisted = JSON.parse(persistedRaw) as {
      readonly version?: number;
      readonly date?: string;
      readonly slates?: ReadonlyArray<{
        readonly draft_group?: { readonly draft_group_id?: string };
        readonly salary_slate?: { readonly draft_group_id?: string };
      }>;
    };

    expect(persisted.version).toBe(2);
    expect(persisted.date).toBe("2026-04-10");
    expect(persisted.slates).toHaveLength(2);
    expect(persisted.slates?.[0]?.draft_group?.draft_group_id).toBe("145340");
    expect(persisted.slates?.[1]?.draft_group?.draft_group_id).toBe("145341");
    expect(persisted.slates?.[0]?.salary_slate?.draft_group_id).toBe("145340");
    expect(persisted.slates?.[1]?.salary_slate?.draft_group_id).toBe("145341");
  });

  it("fails closed and writes nothing when no same-date Classic group exists", async () => {
    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockResolvedValue({
      success: true,
      data: [
        makeDraftGroup({
          draft_group_id: "145500",
          min_start_time: asISOTimestamp("2026-04-11T23:05:00Z")
        })
      ]
    });

    const result = await backfillDraftKingsClassicSlate({
      date: "2026-04-10",
      artifactDir
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected backfill failure");
    expect(result.error).toBe(
      `DraftKings Classic upcoming capture no longer includes 2026-04-10; replay requires a previously captured artifact at ${join(artifactDir, "2026-04-10.json")}.`
    );
    await expect(access(join(artifactDir, "2026-04-10.json"))).rejects.toThrow();
    expect(fetchDraftKingsClassicSalarySlate).not.toHaveBeenCalled();
  });

  it("loads the backfilled artifact through persisted fallback after live upcoming rotation", async () => {
    const draftGroup = makeDraftGroup();
    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockResolvedValueOnce({
      success: true,
      data: [draftGroup]
    });
    vi.mocked(fetchDraftKingsClassicSalarySlate).mockResolvedValueOnce({
      success: true,
      data: makeSalarySlate("145340")
    });

    const backfilled = await backfillDraftKingsClassicSlate({
      date: "2026-04-10",
      artifactDir
    });
    expect(backfilled.success).toBe(true);

    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockResolvedValueOnce({
      success: true,
      data: [
        makeDraftGroup({
          draft_group_id: "145500",
          min_start_time: asISOTimestamp("2026-04-11T23:05:00Z")
        })
      ]
    });

    const loaded = await loadDraftKingsClassicSlate({
      date: "2026-04-10",
      artifactDir
    });

    expect(loaded.success).toBe(true);
    if (!loaded.success) throw new Error(loaded.error);
    expect(loaded.data.source).toBe("draftkings-classic-persisted");
    expect(loaded.data.slates).toHaveLength(1);
    expect(loaded.data.slates[0]?.draft_group_id).toBe("145340");
    expect(fetchUpcomingDraftKingsClassicDraftGroups).toHaveBeenCalledTimes(2);
    expect(fetchDraftKingsClassicSalarySlate).toHaveBeenCalledTimes(1);
  });

  it("returns ok with null artifactPath when filesystem write fails (Vercel read-only /var/task)", async () => {
    // Simulate a production environment where the filesystem write cannot succeed.
    // We pre-create a DIRECTORY at the artifact file path so writeFile fails with EISDIR.
    // backfillDraftKingsClassicSlate must still return ok because Supabase is the
    // authoritative persistence path — the filesystem write is local-dev only.
    const { mkdir: fsMkdir } = await import("node:fs/promises");
    await fsMkdir(join(artifactDir, "2026-04-10.json"), { recursive: true });

    const draftGroup = makeDraftGroup();
    vi.mocked(fetchUpcomingDraftKingsClassicDraftGroups).mockResolvedValue({
      success: true,
      data: [draftGroup]
    });
    vi.mocked(fetchDraftKingsClassicSalarySlate).mockResolvedValue({
      success: true,
      data: makeSalarySlate("145340")
    });

    const result = await backfillDraftKingsClassicSlate({
      date: "2026-04-10",
      artifactDir
    });

    // Must succeed — the Supabase write path is the authoritative production path.
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // artifactPath is null because the filesystem write was not possible.
    expect(result.data.artifactPath).toBeNull();

    // Slates are still returned — the Supabase write happened (non-fatal swallowed).
    expect(result.data.slates).toHaveLength(1);
    expect(result.data.slates[0]?.draft_group_id).toBe("145340");
  });
});