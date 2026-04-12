import { afterEach, describe, expect, it, vi } from "vitest";
import { asISOTimestamp } from "../../lib/contracts/types";

vi.mock("../../lib/services/loadDraftKingsClassicSlate", async () => {
  const actual = await vi.importActual<typeof import("../../lib/services/loadDraftKingsClassicSlate")>(
    "../../lib/services/loadDraftKingsClassicSlate"
  );

  return {
    ...actual,
    backfillDraftKingsClassicSlate: vi.fn()
  };
});

import { backfillDraftKingsClassicSlate } from "../../lib/services/loadDraftKingsClassicSlate";
import { runBackfillDraftKingsClassicSlateCli } from "../../scripts/backfillDraftKingsClassicSlate";

const createIo = () => {
  const logs: string[] = [];
  const errors: string[] = [];

  return {
    logs,
    errors,
    io: {
      log: (message: string) => {
        logs.push(message);
      },
      error: (message: string) => {
        errors.push(message);
      }
    }
  };
};

describe("runBackfillDraftKingsClassicSlateCli", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("exits nonzero on missing date", async () => {
    const { errors, io } = createIo();

    const code = await runBackfillDraftKingsClassicSlateCli([], io);

    expect(code).toBe(1);
    expect(errors[0]).toContain("usage:");
  });

  it("exits nonzero on invalid date", async () => {
    const { errors, io } = createIo();

    const code = await runBackfillDraftKingsClassicSlateCli(["2026-04"], io);

    expect(code).toBe(1);
    expect(errors[0]).toContain("usage:");
  });

  it("exits nonzero when no matching slate exists", async () => {
    vi.mocked(backfillDraftKingsClassicSlate).mockResolvedValue({
      success: false,
      error: "DraftKings Classic upcoming capture no longer includes 2026-04-10; replay requires a previously captured artifact at data/draftkings-classic/2026-04-10.json."
    });
    const { errors, io } = createIo();

    const code = await runBackfillDraftKingsClassicSlateCli(["2026-04-10"], io);

    expect(code).toBe(1);
    expect(errors[0]).toContain("FAILED:");
    expect(errors[0]).toContain("DraftKings Classic upcoming capture no longer includes 2026-04-10; replay requires a previously captured artifact at data/draftkings-classic/2026-04-10.json.");
  });

  it("exits zero on success", async () => {
    vi.mocked(backfillDraftKingsClassicSlate).mockResolvedValue({
      success: true,
      data: {
        artifactPath: "data/draftkings-classic/2026-04-10.json",
        slates: [
          {
            draft_group_id: "145340",
            label: "Featured DraftKings Classic Main",
            min_start_time: "2026-04-10T23:05:00Z",
            max_start_time: "2026-04-11T02:30:00Z",
            salary_slate: {
              provider: "draftkings",
              contest_type: "classic",
              draft_group_id: "145340",
              source: {
                provider: "draftkings",
                endpoint: "https://example.test/dk",
                fetched_at: asISOTimestamp("2026-04-10T18:00:00Z"),
                raw_payload_hash: null
              },
              salaries: []
            }
          }
        ]
      }
    });
    const { logs, errors, io } = createIo();

    const code = await runBackfillDraftKingsClassicSlateCli(["2026-04-10"], io);

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(logs[0]).toContain("SUCCESS date=2026-04-10");
    expect(logs[1]).toContain("artifact: data/draftkings-classic/2026-04-10.json");
    expect(logs[2]).toContain("slates: 1");
  });
});