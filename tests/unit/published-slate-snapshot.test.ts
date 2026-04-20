/**
 * published-slate-snapshot.test.ts
 *
 * Proves that storePublishedSlateSnapshot surfaces Supabase write failures
 * rather than swallowing them. The prior behavior discarded the { error }
 * return from the upsert call entirely, causing silent empty-table failures.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreSnapshotResult, PublishedSlateSnapshotRow } from "../../lib/supabase/publishedSlateSnapshot";
import type { SlateSnapshotPayload } from "../../lib/contracts/slate-snapshot";

// ---------------------------------------------------------------------------
// Mock getSupabaseWriteClient so no real DB connection is made.
// Each test controls what the upsert returns.
// ---------------------------------------------------------------------------

const mockUpsert = vi.fn();

vi.mock("../../lib/supabase/writeClient", () => ({
  getSupabaseWriteClient: () => ({
    from: () => ({
      upsert: mockUpsert,
      select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) })
    })
  })
}));

// Import AFTER mocks are registered.
const { storePublishedSlateSnapshot } = await import(
  "../../lib/supabase/publishedSlateSnapshot"
);

// ---------------------------------------------------------------------------
// Minimal valid row — only what the function needs to build the upsert.
// ---------------------------------------------------------------------------

const minimalRow: PublishedSlateSnapshotRow = {
  date: "2026-04-20",
  run_id: null,
  generated_at: "2026-04-20T13:00:00.000Z",
  publication_state: "valid",
  degradation: null,
  payload: {} as unknown as SlateSnapshotPayload
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("storePublishedSlateSnapshot — write failure is surfaced", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
  });

  it("returns ok: true when Supabase upsert succeeds", async () => {
    mockUpsert.mockResolvedValue({ data: null, error: null });

    const result: StoreSnapshotResult = await storePublishedSlateSnapshot(minimalRow);

    expect(result.ok).toBe(true);
  });

  it("returns ok: false with error message when Supabase returns an error", async () => {
    mockUpsert.mockResolvedValue({
      data: null,
      error: { message: "new row violates row-level security policy" }
    });

    const result: StoreSnapshotResult = await storePublishedSlateSnapshot(minimalRow);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("row-level security policy");
    }
  });

  it("returns ok: false with error message when Supabase returns a schema mismatch error", async () => {
    mockUpsert.mockResolvedValue({
      data: null,
      error: { message: 'column "payload" is of type jsonb but expression is of type text' }
    });

    const result: StoreSnapshotResult = await storePublishedSlateSnapshot(minimalRow);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("jsonb");
    }
  });

  it("returns ok: false when the upsert call itself throws", async () => {
    mockUpsert.mockRejectedValue(new Error("network timeout"));

    const result: StoreSnapshotResult = await storePublishedSlateSnapshot(minimalRow);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("network timeout");
    }
  });

  it("calls upsert with onConflict: date", async () => {
    mockUpsert.mockResolvedValue({ data: null, error: null });

    await storePublishedSlateSnapshot(minimalRow);

    expect(mockUpsert).toHaveBeenCalledOnce();
    const [, options] = mockUpsert.mock.calls[0]!;
    expect(options).toEqual({ onConflict: "date" });
  });
});
