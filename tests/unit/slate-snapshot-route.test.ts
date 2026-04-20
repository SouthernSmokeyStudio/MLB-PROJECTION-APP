import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { asISOTimestamp } from "../../lib/contracts/types";
import { buildSlateSnapshot } from "../../lib/services";
import { parseSlateSnapshotPayload } from "../../lib/slate-snapshot";
import type { PublishedSlateSnapshotRow } from "../../lib/supabase/publishedSlateSnapshot";

vi.mock("@lib/supabase/publishedSlateSnapshot", () => ({
  loadPublishedSlateSnapshot: vi.fn()
}));

vi.mock("@lib/materializer/schedule", async () => {
  const actual = await vi.importActual<typeof import("@lib/materializer/schedule")>("@lib/materializer/schedule");
  return {
    ...actual,
    getDateInScheduleTimezone: vi.fn(() => "2026-04-12")
  };
});

import { GET } from "@/app/api/slate-snapshot/route";
import { loadPublishedSlateSnapshot } from "@lib/supabase/publishedSlateSnapshot";
import { getDateInScheduleTimezone } from "@lib/materializer/schedule";

const GENERATED_AT = asISOTimestamp("2026-04-12T13:00:00Z");
const DATE = "2026-04-12";

const makeValidSnapshot = (): PublishedSlateSnapshotRow => {
  const payload = buildSlateSnapshot([], {
    source: "mlb-statsapi-live",
    date: DATE,
    generated_at: GENERATED_AT,
    counts: { fetched_raw: 0, parsed: 0, normalized: 0, prepared: 0, boxscore_enriched: 0 },
    simulation: { seed: 20260328, iterations: 250 },
    schedule: { source: "mlb-statsapi-live", note: null },
    player_projections: { source: "mlb-statsapi-live", note: null },
    dfs_edge_degraded: { source: "mlb-statsapi-live+draftkings-classic", note: "No DraftKings Classic salary captured." },
    betting_edge_degraded: { source: "mlb-statsapi-live+draftkings-sportsbook-moneyline", note: "No moneyline captured." }
  });
  return {
    date: DATE,
    run_id: "run-abc123",
    generated_at: GENERATED_AT,
    publication_state: "valid",
    degradation: null,
    payload
  };
};

describe("/api/slate-snapshot route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns snapshot payload with 200 when a valid published snapshot exists", async () => {
    const snapshot = makeValidSnapshot();
    vi.mocked(loadPublishedSlateSnapshot).mockResolvedValue(snapshot);

    const response = await GET(
      new NextRequest("http://localhost/api/slate-snapshot?date=2026-04-12")
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.mode).toBe("slate-snapshot-v1");
    expect(body.date).toBe(DATE);
    expect(loadPublishedSlateSnapshot).toHaveBeenCalledWith("2026-04-12");
  });

  it("returns 202 with degraded metadata when no snapshot is published", async () => {
    vi.mocked(loadPublishedSlateSnapshot).mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/slate-snapshot?date=2026-04-12")
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(202);
    expect(body.ok).toBe(false);
    expect(body.degraded).toBe(true);
    expect(body.date).toBe("2026-04-12");
    expect(typeof body.reason).toBe("string");
  });

  it("returns degraded payload with ok+degraded envelope when publication_state is degraded", async () => {
    const snapshot = makeValidSnapshot();
    const degraded: PublishedSlateSnapshotRow = {
      ...snapshot,
      publication_state: "degraded",
      degradation: { blocked_sections: ["dfs_edge"] }
    };
    vi.mocked(loadPublishedSlateSnapshot).mockResolvedValue(degraded);

    const response = await GET(
      new NextRequest("http://localhost/api/slate-snapshot?date=2026-04-12")
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.publication_state).toBe("degraded");
    expect(body.run_id).toBe("run-abc123");
    expect(body.mode).toBe("slate-snapshot-v1");
  });

  it("defaults date from schedule timezone when no query param is provided", async () => {
    vi.mocked(loadPublishedSlateSnapshot).mockResolvedValue(null);

    await GET(new NextRequest("http://localhost/api/slate-snapshot"));

    expect(getDateInScheduleTimezone).toHaveBeenCalled();
    expect(loadPublishedSlateSnapshot).toHaveBeenCalledWith("2026-04-12");
  });

  it("valid snapshot passes round-trip validation through parseSlateSnapshotPayload", async () => {
    const snapshot = makeValidSnapshot();
    vi.mocked(loadPublishedSlateSnapshot).mockResolvedValue(snapshot);

    const response = await GET(
      new NextRequest("http://localhost/api/slate-snapshot?date=2026-04-12")
    );

    expect(response.status).toBe(200);
    const rawPayload = await response.json();

    expect(() => parseSlateSnapshotPayload(rawPayload)).not.toThrow();
    const validated = parseSlateSnapshotPayload(rawPayload);
    expect(validated.mode).toBe("slate-snapshot-v1");
    expect(validated.version).toBe(1);
  });
});
