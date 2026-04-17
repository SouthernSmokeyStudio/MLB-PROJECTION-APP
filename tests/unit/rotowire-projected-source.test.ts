/**
 * rotowire-projected-source.test.ts
 *
 * Proves the Rotowire projected-source adapter contract:
 *
 * 1. Real provider HTML is parsed into canonical projected shapes
 * 2. Adapter failure is fail-closed (network, HTTP, parse errors)
 * 3. Malformed provider HTML is rejected safely
 * 4. No provider-specific fields leak past the adapter boundary
 * 5. Team abbreviation normalization handles Rotowire divergences
 * 6. Adapter satisfies ProjectedSourceAdapter interface
 * 7. Player names use URL slugs (not abbreviated display names)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  createRotowireProjectedSourceAdapter,
  parseRotowireHtml
} from "../../lib/adapters/rotowireProjectedSource";
import type { ProjectedSourceAdapter } from "../../lib/contracts/projected-source";

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const fixtureDir = join(__dirname, "../../data/fixtures/rotowire");

const loadHtmlFixture = (name: string): string =>
  readFileSync(join(fixtureDir, name), "utf-8");

// ---------------------------------------------------------------------------
// Mock fetch globally for adapter-level tests
// ---------------------------------------------------------------------------

const mockFetchHtml = (html: string, status = 200, contentType = "text/html; charset=utf-8") => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? contentType : null },
    text: () => Promise.resolve(html)
  });
};

const mockFetchError = (error: string) => {
  global.fetch = vi.fn().mockRejectedValue(new Error(error));
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. HTML Parser: valid response
// ---------------------------------------------------------------------------

describe("parseRotowireHtml — valid response", () => {
  it("parses a full valid HTML response into RwGame[]", () => {
    const html = loadHtmlFixture("valid-response.html");
    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.away_team).toBe("NYY");
    expect(result.data[0]!.home_team).toBe("BOS");
    expect(result.data[0]!.game_date).toBe("2026-04-10");
  });

  it("extracts pitcher from player-highlight-name href slug", () => {
    const html = loadHtmlFixture("valid-response.html");
    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // Away starter: gerrit-cole (from href, not display name)
    expect(result.data[0]!.away_starter).not.toBeNull();
    expect(result.data[0]!.away_starter!.name).toBe("gerrit cole");
    expect(result.data[0]!.away_starter!.hand).toBe("R");
    expect(result.data[0]!.away_starter!.status).toBe("confirmed");

    // Home starter: chris-sale
    expect(result.data[0]!.home_starter).not.toBeNull();
    expect(result.data[0]!.home_starter!.name).toBe("chris sale");
    expect(result.data[0]!.home_starter!.hand).toBe("L");
    expect(result.data[0]!.home_starter!.status).toBe("expected");
  });

  it("extracts lineup players with batting order from DOM position", () => {
    const html = loadHtmlFixture("valid-response.html");
    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // Away lineup: 3 players
    expect(result.data[0]!.away_lineup).toHaveLength(3);
    expect(result.data[0]!.away_lineup![0]!.name).toBe("aaron judge");
    expect(result.data[0]!.away_lineup![0]!.batting_order).toBe(1);
    expect(result.data[0]!.away_lineup![0]!.position).toBe("RF");
    expect(result.data[0]!.away_lineup![0]!.hand).toBe("R");

    expect(result.data[0]!.away_lineup![1]!.name).toBe("juan soto");
    expect(result.data[0]!.away_lineup![1]!.batting_order).toBe(2);

    expect(result.data[0]!.away_lineup![2]!.name).toBe("anthony rizzo");
    expect(result.data[0]!.away_lineup![2]!.batting_order).toBe(3);

    // Home lineup: 2 players
    expect(result.data[0]!.home_lineup).toHaveLength(2);
    expect(result.data[0]!.home_lineup![0]!.name).toBe("jarren duran");
    expect(result.data[0]!.home_lineup![1]!.name).toBe("rafael devers");
  });

  it("game with pitcher but no lineup produces null lineup", () => {
    const html = loadHtmlFixture("valid-response.html");
    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // Game 2: LAD @ SF — away has pitcher only, home has nothing
    expect(result.data[1]!.away_starter).not.toBeNull();
    expect(result.data[1]!.away_starter!.name).toBe("clayton kershaw");
    expect(result.data[1]!.away_lineup).toBeNull();
    expect(result.data[1]!.home_starter).toBeNull();
    expect(result.data[1]!.home_lineup).toBeNull();
  });

  it("empty string → err", () => {
    const result = parseRotowireHtml("", "2026-04-10");
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("empty");
  });

  it("Rotowire page with lineup__ structure but no is-mlb cards → ok with 0 games (off-day)", () => {
    // A real Rotowire off-day page still carries the lineup__ class structure
    // in its template even when no games are scheduled.
    const result = parseRotowireHtml(
      "<html><body><div class=\"lineup__container\"><p>No games scheduled today.</p></div></body></html>",
      "2026-04-10"
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toHaveLength(0);
  });

  it("single promotional card (no team abbr) is skipped → ok([])", () => {
    const html = `
      <div class="lineup is-mlb is-tools">
        <div class="lineup__box">
          <div class="lineup__main">You may also be interested in...</div>
        </div>
      </div>`;

    const result = parseRotowireHtml(html, "2026-04-10");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toHaveLength(0);
  });

  it("many cards with missing lineup__abbr → err (structure change guard)", () => {
    // Simulates Rotowire renaming lineup__abbr to something else.
    // 5 card sections that look like game cards but have no lineup__abbr.
    const cards = Array.from({ length: 5 }, (_, i) =>
      `<div class="lineup is-mlb">` +
      `<div class="lineup__teams">` +
      `<span class="lineup__team-name">Team${i}A</span>` +
      `<span class="lineup__team-name">Team${i}B</span>` +
      `</div>` +
      `<div class="lineup__main">` +
      `<ul class="lineup__list is-visit">` +
      `<li class="lineup__player-highlight mb-0">` +
      `<div class="lineup__player-highlight-name">` +
      `<a href="/baseball/player/pitcher-${i}-999">Pitcher ${i}</a>` +
      `<span class="lineup__throws">R</span></div></li></ul>` +
      `<ul class="lineup__list is-home"></ul></div></div>`
    ).join("");
    const html = `<html><body>${cards}</body></html>`;

    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail — all cards were silently skipped");
    expect(result.error).toContain("5 lineup card sections");
    expect(result.error).toContain("none yielded");
    expect(result.error).toContain("structure change");
  });

  it("15 game cards + 1 tools card with restructured HTML → err", () => {
    // Simulates: lineup__abbr renamed, tools card also present.
    // 15 real-looking cards + 1 tools card = 16 sections, 0 games.
    const gameCards = Array.from({ length: 15 }, () =>
      `<div class="lineup is-mlb">` +
      `<div class="lineup__teams">` +
      `<span class="new-abbr-class">NYY</span>` +
      `<span class="new-abbr-class">BOS</span>` +
      `</div></div>`
    ).join("");
    const toolsCard =
      `<div class="lineup is-mlb is-tools">` +
      `<div>You may also be interested in...</div></div>`;
    const html = `<html><body>${gameCards}${toolsCard}</body></html>`;

    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail — structure change");
    expect(result.error).toContain("16 lineup card sections");
    expect(result.error).toContain("none yielded");
  });

  it("valid game cards + 1 skipped tools card → ok with games", () => {
    // Normal runtime scenario: real game cards + one promotional card.
    const gameCard =
      `<div class="lineup is-mlb">` +
      `<div class="lineup__teams">` +
      `<div class="lineup__team is-visit"><div class="lineup__abbr">NYY</div></div>` +
      `<div class="lineup__team is-home"><div class="lineup__abbr">BOS</div></div>` +
      `</div>` +
      `<div class="lineup__main">` +
      `<ul class="lineup__list is-visit"></ul>` +
      `<ul class="lineup__list is-home"></ul>` +
      `</div></div>`;
    const toolsCard =
      `<div class="lineup is-mlb is-tools">` +
      `<div>Promotional content</div></div>`;
    const html = `<html><body>${gameCard}${toolsCard}</body></html>`;

    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.away_team).toBe("NYY");
  });
});

// ---------------------------------------------------------------------------
// 2. HTML Parser: player name accuracy from URL slugs
// ---------------------------------------------------------------------------

describe("parseRotowireHtml — URL slug player names", () => {
  it("uses URL slug for pitcher name, not abbreviated display text", () => {
    // Display text says "S. Woods Richardson" but URL slug is
    // "simeon-woods-richardson-15499"
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__teams">
          <div class="lineup__team is-visit"><div class="lineup__abbr">MIN</div></div>
          <div class="lineup__team is-home"><div class="lineup__abbr">TOR</div></div>
        </div>
        <div class="lineup__main">
          <ul class="lineup__list is-visit">
            <li class="lineup__player-highlight mb-0">
              <div class="lineup__player-highlight-name">
                <a href="/baseball/player/simeon-woods-richardson-15499">S. Woods Richardson</a>
                <span class="lineup__throws">R</span>
              </div>
            </li>
            <li class="lineup__status is-expected">Expected</li>
          </ul>
          <ul class="lineup__list is-home"></ul>
        </div>
      </div>`;

    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // Name comes from slug, not display text
    expect(result.data[0]!.away_starter!.name).toBe("simeon woods richardson");
  });

  it("uses URL slug for lineup player name", () => {
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__teams">
          <div class="lineup__team is-visit"><div class="lineup__abbr">NYY</div></div>
          <div class="lineup__team is-home"><div class="lineup__abbr">BOS</div></div>
        </div>
        <div class="lineup__main">
          <ul class="lineup__list is-visit">
            <li class="lineup__player">
              <div class="lineup__pos">RF</div>
              <a title="Aaron Judge" href="/baseball/player/aaron-judge-12346">Aaron Judge</a>
              <span class="lineup__bats">R</span>
            </li>
          </ul>
          <ul class="lineup__list is-home"></ul>
        </div>
      </div>`;

    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data[0]!.away_lineup![0]!.name).toBe("aaron judge");
  });

  it("handles J.T. name edge case via URL slug", () => {
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__teams">
          <div class="lineup__team is-visit"><div class="lineup__abbr">NYM</div></div>
          <div class="lineup__team is-home"><div class="lineup__abbr">ATL</div></div>
        </div>
        <div class="lineup__main">
          <ul class="lineup__list is-visit">
            <li class="lineup__player-highlight mb-0">
              <div class="lineup__player-highlight-name">
                <a href="/baseball/player/jt-ginn-15428">J.T. Ginn</a>
                <span class="lineup__throws">R</span>
              </div>
            </li>
            <li class="lineup__status is-expected">Expected</li>
          </ul>
          <ul class="lineup__list is-home"></ul>
        </div>
      </div>`;

    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // URL slug "jt-ginn" → name "jt ginn" (not "j.t. ginn")
    expect(result.data[0]!.away_starter!.name).toBe("jt ginn");
  });
});

// ---------------------------------------------------------------------------
// 3. Full adapter: canonical projected shapes
// ---------------------------------------------------------------------------

describe("rotowire adapter — canonical shape normalization", () => {
  it("normalizes valid HTML into ProjectedSourceResult with canonical types", async () => {
    const html = loadHtmlFixture("valid-response.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.provider_meta.provider).toBe("rotowire");
    expect(result.data.provider_meta.source_url).toBe("https://example.com/rotowire");
    expect(result.data.date).toBe("2026-04-10");
    expect(result.data.games).toHaveLength(2);

    // Game 1: NYY @ BOS
    const game1 = result.data.games[0]!;
    expect(game1.game_id).toBe("mlb-2026-04-10-nyy-bos");

    // Away starter
    expect(game1.away_starter).not.toBeNull();
    expect(game1.away_starter!.player_id).toBe("gerrit-cole");
    expect(game1.away_starter!.full_name).toBe("gerrit cole");
    expect(game1.away_starter!.team_id).toBe("nyy");
    expect(game1.away_starter!.handedness).toBe("R");
    expect(game1.away_starter!.starting_status).toBe("confirmed");
    expect(game1.away_starter!.confidence).toBe("high");

    // Home starter
    expect(game1.home_starter).not.toBeNull();
    expect(game1.home_starter!.player_id).toBe("chris-sale");
    expect(game1.home_starter!.full_name).toBe("chris sale");
    expect(game1.home_starter!.team_id).toBe("bos");
    expect(game1.home_starter!.handedness).toBe("L");
    expect(game1.home_starter!.starting_status).toBe("expected");
    expect(game1.home_starter!.confidence).toBe("medium");

    // Away lineup
    expect(game1.away_lineup).toHaveLength(3);
    expect(game1.away_lineup![0]!.player_id).toBe("aaron-judge");
    expect(game1.away_lineup![0]!.team_id).toBe("nyy");
    expect(game1.away_lineup![0]!.batting_order).toBe(1);
    expect(game1.away_lineup![0]!.position).toBe("RF");
    expect(game1.away_lineup![0]!.starting_status).toBe("expected");

    // Home lineup
    expect(game1.home_lineup).toHaveLength(2);
    expect(game1.home_lineup![0]!.player_id).toBe("jarren-duran");

    // Game 2: LAD @ SF
    const game2 = result.data.games[1]!;
    expect(game2.game_id).toBe("mlb-2026-04-10-lad-sf");
    expect(game2.away_starter!.player_id).toBe("clayton-kershaw");
    expect(game2.away_starter!.starting_status).toBe("expected");
    expect(game2.home_starter).toBeNull();
    expect(game2.away_lineup).toBeNull();
    expect(game2.home_lineup).toBeNull();
  });

  it("team abbreviation divergences are normalized to canonical", async () => {
    const html = loadHtmlFixture("divergent-abbreviations.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.games).toHaveLength(2);

    // WAS → WSH, SFG → SF
    const game1 = result.data.games[0]!;
    expect(game1.game_id).toBe("mlb-2026-04-10-wsh-sf");
    expect(game1.away_starter!.team_id).toBe("wsh");
    expect(game1.home_starter!.team_id).toBe("sf");

    // TBR → TB, KCR → KC (not-in-slate game, still parsed)
    const game2 = result.data.games[1]!;
    expect(game2.game_id).toBe("mlb-2026-04-10-tb-kc");
  });
});

// ---------------------------------------------------------------------------
// 4. Adapter failure is fail-closed
// ---------------------------------------------------------------------------

describe("rotowire adapter — fail-closed", () => {
  it("network error returns err, does not throw", async () => {
    mockFetchError("ECONNREFUSED");

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("fetch failed");
  });

  it("HTTP 500 returns err", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("")
    });

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("HTTP 500");
  });

  it("HTTP 403 returns err", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("")
    });

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("HTTP 403");
  });

  it("response.text() failure returns err", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null },
      text: () => Promise.reject(new Error("stream error"))
    });

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("could not be read");
  });

  it("Rotowire page with lineup__ structure but no is-mlb cards is valid (0 games, off-day)", async () => {
    mockFetchHtml("<html><body><div class=\"lineup__container\">No games today.</div></body></html>");

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.games).toHaveLength(0);
  });

  it("HTML with single promotional card (no team abbr) skips it gracefully", async () => {
    const html = `
      <div class="lineup is-mlb is-tools">
        <div class="lineup__main">You may also be interested in...</div>
      </div>`;
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.games).toHaveLength(0);
  });

  it("many card sections with zero extractable games → err (structure change)", async () => {
    const cards = Array.from({ length: 10 }, () =>
      `<div class="lineup is-mlb">` +
      `<div class="lineup__teams">` +
      `<span class="renamed-class">NYY</span>` +
      `</div></div>`
    ).join("");
    mockFetchHtml(`<html>${cards}</html>`);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail — structure change");
    expect(result.error).toContain("10 lineup card sections");
    expect(result.error).toContain("none yielded");
  });

  it("unrecognized team abbreviation → err (not silent skip)", async () => {
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__teams">
          <div class="lineup__team is-visit"><div class="lineup__abbr">ZZZZZ</div></div>
          <div class="lineup__team is-home"><div class="lineup__abbr">BOS</div></div>
        </div>
        <div class="lineup__main">
          <ul class="lineup__list is-visit"></ul>
          <ul class="lineup__list is-home"></ul>
        </div>
      </div>`;
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("unrecognized");
    expect(result.error).toContain("ZZZZZ");
  });
});

// ---------------------------------------------------------------------------
// 5. No provider-specific leakage
// ---------------------------------------------------------------------------

describe("rotowire adapter — no provider-specific leakage", () => {
  it("ProjectedStarter has only canonical fields", async () => {
    const html = loadHtmlFixture("valid-response.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const starter = result.data.games[0]!.away_starter!;
    const keys = Object.keys(starter).sort();
    expect(keys).toEqual([
      "confidence",
      "full_name",
      "handedness",
      "player_id",
      "starting_status",
      "team_id"
    ]);

    // No Rotowire-specific fields
    expect(starter).not.toHaveProperty("name");
    expect(starter).not.toHaveProperty("hand");
    expect(starter).not.toHaveProperty("status");
  });

  it("ProjectedLineupEntry has only canonical fields", async () => {
    const html = loadHtmlFixture("valid-response.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const entry = result.data.games[0]!.away_lineup![0]!;
    const keys = Object.keys(entry).sort();
    expect(keys).toEqual([
      "batting_order",
      "player_id",
      "position",
      "starting_status",
      "team_id"
    ]);

    // No Rotowire-specific fields
    expect(entry).not.toHaveProperty("name");
    expect(entry).not.toHaveProperty("hand");
  });

  it("ProjectedSourceResult.provider_meta has only canonical fields", async () => {
    const html = loadHtmlFixture("valid-response.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const metaKeys = Object.keys(result.data.provider_meta).sort();
    expect(metaKeys).toEqual(["fetched_at", "provider", "source_url"]);
  });
});

// ---------------------------------------------------------------------------
// 6. Adapter satisfies ProjectedSourceAdapter interface
// ---------------------------------------------------------------------------

describe("rotowire adapter — contract compliance", () => {
  it("adapter has source discriminant 'rotowire'", () => {
    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    expect(adapter.source).toBe("rotowire");
  });

  it("adapter is assignable to ProjectedSourceAdapter", () => {
    const adapter: ProjectedSourceAdapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    // Type-level proof — if this compiles, the adapter satisfies the contract
    expect(adapter.source).toBe("rotowire");
    expect(typeof adapter.fetchProjectedData).toBe("function");
  });

  it("different endpoint URLs produce different adapter instances", () => {
    const a = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://api.example.com/v1/lineups"
    });
    const b = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://api.example.com/v2/lineups"
    });

    // Same source discriminant — both are Rotowire adapters
    expect(a.source).toBe(b.source);
  });
});

// ---------------------------------------------------------------------------
// 7. Edge cases
// ---------------------------------------------------------------------------

describe("rotowire adapter — edge cases", () => {
  it("null starters and lineups when lists are empty", async () => {
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__teams">
          <div class="lineup__team is-visit"><div class="lineup__abbr">NYY</div></div>
          <div class="lineup__team is-home"><div class="lineup__abbr">BOS</div></div>
        </div>
        <div class="lineup__main">
          <ul class="lineup__list is-visit"></ul>
          <ul class="lineup__list is-home"></ul>
        </div>
      </div>`;
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    const game = result.data.games[0]!;
    expect(game.away_starter).toBeNull();
    expect(game.home_starter).toBeNull();
    expect(game.away_lineup).toBeNull();
    expect(game.home_lineup).toBeNull();
  });

  it("game_id constructed from date + normalized abbreviations", async () => {
    const html = loadHtmlFixture("divergent-abbreviations.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // WAS→WSH, SFG→SF in game_id construction
    expect(result.data.games[0]!.game_id).toBe("mlb-2026-04-10-wsh-sf");
    // TBR→TB, KCR→KC (not-in-slate card, still parsed)
    expect(result.data.games[1]!.game_id).toBe("mlb-2026-04-10-tb-kc");
  });

  it("not-in-slate games are still parsed", async () => {
    const html = loadHtmlFixture("divergent-abbreviations.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // Second game has not-in-slate class — should still be included
    expect(result.data.games).toHaveLength(2);
  });

  it("confirmed status produces high confidence on starter", async () => {
    const html = loadHtmlFixture("valid-response.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    // Away side in game 1 has is-confirmed status
    expect(result.data.games[0]!.away_starter!.starting_status).toBe("confirmed");
    expect(result.data.games[0]!.away_starter!.confidence).toBe("high");

    // Home side has is-expected status
    expect(result.data.games[0]!.home_starter!.starting_status).toBe("expected");
    expect(result.data.games[0]!.home_starter!.confidence).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// 8. Real-world HTML structure proof
// ---------------------------------------------------------------------------

describe("rotowire adapter — real-world HTML shape", () => {
  it("parses the real Rotowire daily lineups page structure", () => {
    // This HTML snippet mirrors the exact structure observed on
    // https://www.rotowire.com/baseball/daily-lineups.php on 2026-04-10.
    // It proves the regex patterns handle real-world whitespace, salary
    // items between players, button elements, and multi-word slugs.
    const realWorldHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head><title>MLB Lineups</title></head>
      <body>
      <div class="lineup is-mlb">
          <div class="lineup__meta flex-row" style="align-items:baseline;">
              <div class="lineup__time">7:07 PM ET</div>
          </div>
          <div class="lineup__box">
              <div class="lineup__top">
                  <div class="lineup__teams">
                      <div class="lineup__team is-visit">
                          <img class="lineup__logo" src="https://content.rotowire.com/images/teamlogo/baseball/100MIN.png?v=8" alt="MIN">
                          <div class="lineup__abbr">MIN</div>
                      </div>
                      <div class="lineup__team is-home">
                          <img class="lineup__logo" src="https://content.rotowire.com/images/teamlogo/baseball/100TOR.png?v=8" alt="TOR">
                          <div class="lineup__abbr">TOR</div>
                      </div>
                  </div>
              </div>
              <a href="/baseball/box-score/blue-jays-vs-twins-2026-04-10-2940200" class="lineup__matchup">
                  <div class="lineup__mteam is-visit">Twins<span class="lineup__wl">(7-6)</span></div>
                  <div class="lineup__mteam is-home">Blue Jays<span class="lineup__wl">(5-7)</span></div>
              </a>
              <div class="lineup__main">
                  <ul class="lineup__list is-visit">
                      <li class="lineup__player-highlight mb-0">
                          <div class="lineup__player-highlight-name">
                              <a href="/baseball/player/simeon-woods-richardson-15499">S. Woods Richardson</a>
                              <span class="lineup__throws">R</span>
                          </div>
                          <div class="lineup__player-highlight-stats">0-1&nbsp;2.31 ERA</div>
                      </li>
                      <li class="lineup__status is-expected">
                          <div class="dot is-medium is-yellow" style="margin-right:5px;"></div>Expected Lineup
                      </li>
                      <li class="lineup__player">
                          <div class="lineup__pos">CF</div>
                          <a title="Byron Buxton" href="/baseball/player/byron-buxton-12448">Byron Buxton</a>
                          <span class="lineup__bats">R</span>
                      </li>
                      <li style="color: #888;font-size: 11px;margin-left: 42px;" class="salaries hide">$4,900</li>
                      <li class="lineup__player">
                          <div class="lineup__pos">DH</div>
                          <a title="Josh Bell" href="/baseball/player/josh-bell-12141">Josh Bell</a>
                          <span class="lineup__bats">S</span>
                      </li>
                      <li style="color: #888;font-size: 11px;margin-left: 42px;" class="salaries hide">$3,600</li>
                      <li>
                          <button class="see-home-run-chances" data-team="MIN">Home Run Odds</button>
                      </li>
                      <li>
                          <button class="see-pitcher-intel" data-pid="15499" data-gid="2940200">Starting Pitcher Intel</button>
                      </li>
                  </ul>
                  <ul class="lineup__list is-home">
                      <li class="lineup__player-highlight mb-0">
                          <div class="lineup__player-highlight-name">
                              <a href="/baseball/player/patrick-corbin-11033">Patrick Corbin</a>
                              <span class="lineup__throws">L</span>
                          </div>
                          <div class="lineup__player-highlight-stats">0-0&nbsp;.00 ERA</div>
                      </li>
                      <li class="lineup__status is-confirmed">
                          <div class="dot is-medium is-green" style="margin-right:5px;"></div>Confirmed
                      </li>
                      <li class="lineup__player">
                          <div class="lineup__pos">1B</div>
                          <a title="Vladimir Guerrero" href="/baseball/player/vladimir-guerrero-13962">V. Guerrero</a>
                          <span class="lineup__bats">R</span>
                      </li>
                      <li style="color: #888;font-size: 11px;margin-left: 42px;" class="salaries hide">$5,500</li>
                  </ul>
              </div>
          </div>
      </div>
      </body>
      </html>`;

    const result = parseRotowireHtml(realWorldHtml, "2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data).toHaveLength(1);

    const game = result.data[0]!;
    expect(game.away_team).toBe("MIN");
    expect(game.home_team).toBe("TOR");

    // Pitcher: abbreviated display "S. Woods Richardson" → slug "simeon woods richardson"
    expect(game.away_starter!.name).toBe("simeon woods richardson");
    expect(game.away_starter!.hand).toBe("R");
    expect(game.away_starter!.status).toBe("expected");

    expect(game.home_starter!.name).toBe("patrick corbin");
    expect(game.home_starter!.hand).toBe("L");
    expect(game.home_starter!.status).toBe("confirmed");

    // Lineup: salary items and buttons between players don't interfere
    expect(game.away_lineup).toHaveLength(2);
    expect(game.away_lineup![0]!.name).toBe("byron buxton");
    expect(game.away_lineup![0]!.position).toBe("CF");
    expect(game.away_lineup![0]!.batting_order).toBe(1);
    expect(game.away_lineup![1]!.name).toBe("josh bell");
    expect(game.away_lineup![1]!.position).toBe("DH");
    expect(game.away_lineup![1]!.batting_order).toBe(2);
    // Switch hitter
    expect(game.away_lineup![1]!.hand).toBe("S");

    expect(game.home_lineup).toHaveLength(1);
    expect(game.home_lineup![0]!.name).toBe("vladimir guerrero");
    expect(game.home_lineup![0]!.position).toBe("1B");
  });
});

// ---------------------------------------------------------------------------
// 9. Content-Type discrimination
// ---------------------------------------------------------------------------

describe("rotowire adapter — Content-Type discrimination", () => {
  it("200 OK with application/json Content-Type → err", async () => {
    const jsonBody = JSON.stringify({ error: "Unauthorized" });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "application/json" : null },
      text: () => Promise.resolve(jsonBody)
    });

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("Content-Type");
    expect(result.error).toContain("application/json");
    expect(result.error).toContain("text/html");
  });

  it("200 OK with empty Content-Type → err", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "" },
      text: () => Promise.resolve("<html>some page</html>")
    });

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("Content-Type");
  });

  it("200 OK with text/html Content-Type proceeds normally", async () => {
    const html = loadHtmlFixture("valid-response.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.games).toHaveLength(2);
  });

  it("200 OK with json-error-body fixture and application/json → err naming Content-Type", async () => {
    const body = JSON.stringify(
      JSON.parse(require("fs").readFileSync(
        require("path").join(__dirname, "../../data/fixtures/rotowire/json-error-body.json"),
        "utf-8"
      ))
    );
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null },
      text: () => Promise.resolve(body)
    });

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("Content-Type");
  });
});

// ---------------------------------------------------------------------------
// 10. Challenge page / maintenance page detection
// ---------------------------------------------------------------------------

describe("parseRotowireHtml — challenge page / maintenance page detection", () => {
  it("CDN challenge page (no lineup__ structure) → err naming the failure", () => {
    const html = loadHtmlFixture("cdn-challenge-page.html");
    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("no lineup structure markers");
  });

  it("maintenance page (no lineup__ structure) → err naming the failure", () => {
    const html = loadHtmlFixture("maintenance-page.html");
    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    expect(result.error).toContain("no lineup structure markers");
  });

  it("plain HTML with no lineup__ structure → err (not silent ok([]))", () => {
    const result = parseRotowireHtml(
      "<html><body><h1>Service Unavailable</h1></body></html>",
      "2026-04-10"
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail — no lineup structure");
    expect(result.error).toContain("no lineup structure markers");
  });

  it("page with lineup__ structure and zero is-mlb cards → ok([]) (legitimate off-day)", () => {
    const result = parseRotowireHtml(
      "<html><body><div class=\"lineup__container\">No games today.</div></body></html>",
      "2026-04-10"
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toHaveLength(0);
  });
});

describe("rotowire adapter — challenge page / maintenance page detection", () => {
  it("CDN challenge page returns err at adapter level (not silent ok)", async () => {
    const html = loadHtmlFixture("cdn-challenge-page.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail — CDN challenge page");
    expect(result.error).toContain("no lineup structure markers");
  });

  it("maintenance page returns err at adapter level (not silent ok)", async () => {
    const html = loadHtmlFixture("maintenance-page.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail — maintenance page");
    expect(result.error).toContain("no lineup structure markers");
  });
});

// ---------------------------------------------------------------------------
// 11. Pitcher block present but missing throws span
// ---------------------------------------------------------------------------

describe("parseRotowireHtml — pitcher block parse failure", () => {
  it("pitcher highlight block present but throws span absent → err (not silent null)", () => {
    const html = loadHtmlFixture("pitcher-block-missing-throws.html");
    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail — pitcher block without throws");
    expect(result.error).toContain("pitcher highlight block present");
    expect(result.error).toContain("could not extract name or handedness");
  });

  it("pitcher block parse error names the game index", () => {
    const html = loadHtmlFixture("pitcher-block-missing-throws.html");
    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    // First game = index 0
    expect(result.error).toContain("Game at index 0");
  });

  it("pitcher block without player-highlight-name produces null starter (legitimate absent pitcher)", () => {
    // No pitcher block at all — game just hasn't posted a starter yet.
    // This should produce starter: null, NOT a parse error.
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__teams">
          <div class="lineup__team is-visit"><div class="lineup__abbr">NYY</div></div>
          <div class="lineup__team is-home"><div class="lineup__abbr">BOS</div></div>
        </div>
        <div class="lineup__main">
          <ul class="lineup__list is-visit">
            <li class="lineup__status is-expected">Expected</li>
          </ul>
          <ul class="lineup__list is-home"></ul>
        </div>
      </div>`;

    const result = parseRotowireHtml(html, "2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data[0]!.away_starter).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. Unknown enum values — no silent coercion
// ---------------------------------------------------------------------------

describe("rotowire adapter — unknown enum values are not silently coerced", () => {
  it("unrecognized pitcher handedness → err naming the value", async () => {
    const html = loadHtmlFixture("unknown-enum-values.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail — unrecognized handedness");
    expect(result.error).toContain("unrecognized handedness value");
    expect(result.error).toContain("\"A\"");
  });

  it("unrecognized lineup player position → err naming the value", async () => {
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__teams">
          <div class="lineup__team is-visit"><div class="lineup__abbr">NYY</div></div>
          <div class="lineup__team is-home"><div class="lineup__abbr">BOS</div></div>
        </div>
        <div class="lineup__main">
          <ul class="lineup__list is-visit"></ul>
          <ul class="lineup__list is-home">
            <li class="lineup__player">
              <div class="lineup__pos">EH</div>
              <a title="Some Player" href="/baseball/player/some-player-9999">Some Player</a>
              <span class="lineup__bats">R</span>
            </li>
          </ul>
        </div>
      </div>`;
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail — unrecognized position");
    expect(result.error).toContain("unrecognized position value");
    expect(result.error).toContain("\"EH\"");
  });

  it("unrecognized starting status → err naming the value", async () => {
    // Simulate Rotowire adding a new status class "is-uncertain"
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__teams">
          <div class="lineup__team is-visit"><div class="lineup__abbr">NYY</div></div>
          <div class="lineup__team is-home"><div class="lineup__abbr">BOS</div></div>
        </div>
        <div class="lineup__main">
          <ul class="lineup__list is-visit">
            <li class="lineup__player-highlight mb-0">
              <div class="lineup__player-highlight-name">
                <a href="/baseball/player/gerrit-cole-1234">Gerrit Cole</a>
                <span class="lineup__throws">R</span>
              </div>
            </li>
            <li class="lineup__status is-uncertain">Uncertain</li>
          </ul>
          <ul class="lineup__list is-home"></ul>
        </div>
      </div>`;
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail — unrecognized status");
    expect(result.error).toContain("unrecognized starting status value");
    expect(result.error).toContain("\"uncertain\"");
  });

  it("empty/missing handedness → ok with 'unknown' (legitimate absent value)", async () => {
    // A pitcher whose throws is blank — this is a genuinely absent value,
    // not an unrecognized new value. Should normalize to "unknown", not error.
    const html = `
      <div class="lineup is-mlb">
        <div class="lineup__teams">
          <div class="lineup__team is-visit"><div class="lineup__abbr">NYY</div></div>
          <div class="lineup__team is-home"><div class="lineup__abbr">BOS</div></div>
        </div>
        <div class="lineup__main">
          <ul class="lineup__list is-visit">
            <li class="lineup__player-highlight mb-0">
              <div class="lineup__player-highlight-name">
                <a href="/baseball/player/gerrit-cole-1234">Gerrit Cole</a>
                <span class="lineup__throws"> </span>
              </div>
            </li>
            <li class="lineup__status is-expected">Expected</li>
          </ul>
          <ul class="lineup__list is-home"></ul>
        </div>
      </div>`;
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data.games[0]!.away_starter!.handedness).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// 13. Partial abbreviation failure — fail-all behavior is explicit
// ---------------------------------------------------------------------------

describe("rotowire adapter — partial abbreviation failure is explicit fail-all", () => {
  it("one bad team abbreviation in a 3-game page → err, all 3 games unavailable", async () => {
    const html = loadHtmlFixture("partial-abbreviation-failure.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    // Fail-all: the bad game (index 1) kills the whole call.
    // Games at index 0 (NYY/BOS) and index 2 (HOU/ATL) are also lost.
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail — ZZZZZ is not a recognized team");
    expect(result.error).toContain("ZZZZZ");
    expect(result.error).toContain("unrecognized");
  });

  it("partial abbreviation failure error names the game index", async () => {
    const html = loadHtmlFixture("partial-abbreviation-failure.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(false);
    if (result.success) throw new Error("Should fail");
    // ZZZZZ is the away team in card at index 1 (0-based)
    expect(result.error).toContain("index 1");
  });
});

// ---------------------------------------------------------------------------
// 14. All-null-sides — structurally valid but data-empty
// ---------------------------------------------------------------------------

describe("rotowire adapter — structurally valid page with all-null game data", () => {
  it("all-null-sides fixture returns ok with 1 game, all sides null", async () => {
    const html = loadHtmlFixture("all-null-sides.html");
    mockFetchHtml(html);

    const adapter = createRotowireProjectedSourceAdapter({
      endpointUrl: "https://example.com/rotowire"
    });

    const result = await adapter.fetchProjectedData("2026-04-10");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    expect(result.data.games).toHaveLength(1);
    const game = result.data.games[0]!;
    expect(game.game_id).toBe("mlb-2026-04-10-nyy-bos");
    expect(game.away_starter).toBeNull();
    expect(game.home_starter).toBeNull();
    expect(game.away_lineup).toBeNull();
    expect(game.home_lineup).toBeNull();
  });
});
