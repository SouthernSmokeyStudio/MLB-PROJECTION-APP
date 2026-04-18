import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftKingsSportsbookMlbMoneylineSlate } from "../../lib/contracts/draftkings-sportsbook-mlb-moneyline";
import { asISOTimestamp } from "../../lib/contracts/types";

vi.mock("@lib/adapters/draftKingsSportsbook", () => ({
  fetchDraftKingsSportsbookMlbMoneylineSlate: vi.fn()
}));

vi.mock("@lib/materializer/schedule", () => ({
  getDateInScheduleTimezone: vi.fn(() => "2026-04-12"),
  MATERIALIZATION_TIMEZONE: "America/Chicago"
}));

import { fetchDraftKingsSportsbookMlbMoneylineSlate } from "@lib/adapters/draftKingsSportsbook";
import {
  captureSportsbookMlbMoneylineSlate,
  loadDraftKingsSportsbookMlbMoneylineSlate
} from "../../lib/services/loadDraftKingsSportsbookMlbMoneylineSlate";

const makeSlate = (
  date: string,
  overrides: Partial<DraftKingsSportsbookMlbMoneylineSlate> = {}
): DraftKingsSportsbookMlbMoneylineSlate => ({
  provider: "draftkings-sportsbook",
  sport: "MLB",
  market_type: "moneyline",
  site: "US-TN-SB",
  league_id: "84240",
  subcategory_id: "4519",
  source: {
    provider: "draftkings-sportsbook",
    endpoint: "https://example.test/dk-sb",
    fetched_at: asISOTimestamp(`${date}T18:00:00Z`),
    raw_payload_hash: null
  },
  entries: [
    {
      event_id: "99001",
      market_id: "1_99001",
      event_name: "NYY @ BOS",
      start_time: asISOTimestamp(`${date}T23:10:00Z`),
      away_team_abbreviation: "NYY",
      away_team_name: "New York Yankees",
      away_starting_pitcher: null,
      home_team_abbreviation: "BOS",
      home_team_name: "Boston Red Sox",
      home_starting_pitcher: null,
      away_odds_american: -130,
      away_odds_decimal: null,
      home_odds_american: 110,
      home_odds_decimal: null
    }
  ],
  ...overrides
});

describe("captureSportsbookMlbMoneylineSlate", () => {
  let artifactDir: string;

  beforeEach(async () => {
    artifactDir = await mkdtemp(join(tmpdir(), "dk-sb-capture-"));
    vi.mocked(fetchDraftKingsSportsbookMlbMoneylineSlate).mockReset();
  });

  afterEach(async () => {
    await rm(artifactDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("writes a version-1 artifact keyed by requested date when matching same-date rows exist", async () => {
    vi.mocked(fetchDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValue({
      success: true,
      data: makeSlate("2026-04-12")
    });

    const result = await captureSportsbookMlbMoneylineSlate({
      date: "2026-04-12",
      artifactDir
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.moneyline_slate.entries).toHaveLength(1);

    const raw = await readFile(join(artifactDir, "2026-04-12.json"), "utf-8");
    const persisted = JSON.parse(raw) as {
      readonly version?: number;
      readonly date?: string;
      readonly moneyline_slate?: { readonly entries?: unknown[] };
    };
    expect(persisted.version).toBe(1);
    expect(persisted.date).toBe("2026-04-12");
    expect(persisted.moneyline_slate?.entries).toHaveLength(1);
  });

  it("fails closed and writes nothing when no same-date rows exist for a past date", async () => {
    vi.mocked(fetchDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValue({
      success: true,
      data: makeSlate("2026-04-11")
    });

    const result = await captureSportsbookMlbMoneylineSlate({
      date: "2026-04-10",
      artifactDir
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContain("same-day capture may already be too late");
    expect(result.error).toContain("2026-04-10");
    await expect(access(join(artifactDir, "2026-04-10.json"))).rejects.toThrow();
  });
});

describe("loadDraftKingsSportsbookMlbMoneylineSlate – persisted fallback", () => {
  let artifactDir: string;

  beforeEach(async () => {
    artifactDir = await mkdtemp(join(tmpdir(), "dk-sb-load-"));
    vi.mocked(fetchDraftKingsSportsbookMlbMoneylineSlate).mockReset();
  });

  afterEach(async () => {
    await rm(artifactDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("loads the captured artifact through persisted fallback after live rows have rotated away", async () => {
    vi.mocked(fetchDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValueOnce({
      success: true,
      data: makeSlate("2026-04-12")
    });
    const captured = await captureSportsbookMlbMoneylineSlate({
      date: "2026-04-12",
      artifactDir
    });
    expect(captured.success).toBe(true);

    vi.mocked(fetchDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValueOnce({
      success: true,
      data: makeSlate("2026-04-13")
    });

    const loaded = await loadDraftKingsSportsbookMlbMoneylineSlate({
      date: "2026-04-12",
      artifactDir
    });

    expect(loaded.success).toBe(true);
    if (!loaded.success) throw new Error(loaded.error);
    expect(loaded.data.source).toBe("draftkings-sportsbook-mlb-moneyline-persisted");
    expect(loaded.data.moneyline_slate).not.toBeNull();
    expect(loaded.data.moneyline_slate?.entries).toHaveLength(1);
    expect(fetchDraftKingsSportsbookMlbMoneylineSlate).toHaveBeenCalledTimes(2);
  });

  it("fails closed when neither live rows nor artifact exists for the date", async () => {
    vi.mocked(fetchDraftKingsSportsbookMlbMoneylineSlate).mockResolvedValue({
      success: true,
      data: makeSlate("2026-04-13")
    });

    const loaded = await loadDraftKingsSportsbookMlbMoneylineSlate({
      date: "2026-04-12",
      artifactDir
    });

    expect(loaded.success).toBe(true);
    if (!loaded.success) throw new Error(loaded.error);
    expect(loaded.data.moneyline_slate).toBeNull();
    expect(loaded.data.source).toBe("draftkings-sportsbook-mlb-moneyline-live");
    expect(loaded.data.note).toContain("No DraftKings Sportsbook MLB pregame moneyline rows matched the requested date.");
  });
});