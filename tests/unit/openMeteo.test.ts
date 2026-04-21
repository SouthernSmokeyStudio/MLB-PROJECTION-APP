/**
 * openMeteo.test.ts
 *
 * Unit tests for the Open-Meteo forecast adapter.
 *
 * Covers:
 *   - Successful fetch + hour match → populated WeatherSummary
 *   - Fetch failure → null + console.warn emitted
 *   - HTTP non-OK response → null + console.warn emitted
 *   - Hour match failure → null + console.warn emitted
 *   - cache: 'no-store' is always passed to fetchWithTimeout
 */

import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@lib/adapters/fetchWithTimeout", () => ({
  fetchWithTimeout: vi.fn()
}));

import { fetchVenueWeather } from "../../lib/adapters/openMeteo";
import { fetchWithTimeout } from "../../lib/adapters/fetchWithTimeout";

const GAME_START_UTC = "2026-04-20T22:10:00Z";
const LAT = 41.4962;
const LNG = -81.6852;

// Open-Meteo hourly payload for 2026-04-20 in UTC (24 hours).
// Index 22 = 22:00 UTC, which matches GAME_START_UTC.
const buildOpenMeteoPayload = (overrides: Partial<{
  times: string[];
  temperature_2m: (number | null)[];
  windspeed_10m: (number | null)[];
  winddirection_10m: (number | null)[];
  weathercode: (number | null)[];
  precipitation_probability: (number | null)[];
}> = {}) => {
  const times = overrides.times ?? Array.from({ length: 24 }, (_, i) => `2026-04-20T${String(i).padStart(2, "0")}:00`);
  return {
    hourly: {
      time: times,
      temperature_2m: overrides.temperature_2m ?? Array.from({ length: 24 }, (_, i) => 40 + i * 0.5),
      windspeed_10m: overrides.windspeed_10m ?? Array.from({ length: 24 }, () => 8.0),
      winddirection_10m: overrides.winddirection_10m ?? Array.from({ length: 24 }, () => 90),
      weathercode: overrides.weathercode ?? Array.from({ length: 24 }, () => 2),
      precipitation_probability: overrides.precipitation_probability ?? Array.from({ length: 24 }, () => 10),
    }
  };
};

const mockOkResponse = (payload: unknown) => {
  vi.mocked(fetchWithTimeout).mockResolvedValue({
    response: {
      ok: true,
      json: async () => payload
    } as unknown as Response,
    error: null
  });
};

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("fetchVenueWeather", () => {
  it("returns populated WeatherSummary when fetch succeeds and hour matches", async () => {
    mockOkResponse(buildOpenMeteoPayload());

    const result = await fetchVenueWeather(LAT, LNG, GAME_START_UTC);

    expect(result).not.toBeNull();
    expect(result?.temperature_f).toBeCloseTo(51.0, 0); // index 22: 40 + 22*0.5 = 51
    expect(result?.wind_speed_mph).toBe(8.0);
    expect(result?.wind_direction).toBe("E"); // 90° → "E"
    expect(result?.conditions).toBe("Partly Cloudy"); // WMO code 2
    expect(result?.precipitation_chance).toBeCloseTo(0.1); // 10 / 100
    expect(result?.dome_closed).toBeNull();
  });

  it("always passes cache: no-store to fetchWithTimeout", async () => {
    mockOkResponse(buildOpenMeteoPayload());

    await fetchVenueWeather(LAT, LNG, GAME_START_UTC);

    expect(vi.mocked(fetchWithTimeout)).toHaveBeenCalledWith(
      expect.stringContaining("api.open-meteo.com"),
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("returns null and warns when fetch response is null (network failure)", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({ response: null, error: "timeout" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await fetchVenueWeather(LAT, LNG, GAME_START_UTC);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "[openMeteo] fetch failed",
      expect.stringContaining("timeout")
    );
  });

  it("returns null and warns when HTTP response is not ok", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      response: { ok: false, status: 429 } as unknown as Response,
      error: null
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await fetchVenueWeather(LAT, LNG, GAME_START_UTC);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "[openMeteo] fetch failed",
      expect.stringContaining("429")
    );
  });

  it("returns null and warns when no hourly slot matches the game start hour", async () => {
    // Times that don't include hour 22
    const payload = buildOpenMeteoPayload({
      times: Array.from({ length: 10 }, (_, i) => `2026-04-20T${String(i).padStart(2, "0")}:00`)
    });
    mockOkResponse(payload);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await fetchVenueWeather(LAT, LNG, GAME_START_UTC);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "[openMeteo] hour match failed",
      expect.stringContaining("2026-04-20T22")
    );
  });

  it("returns null when hourly payload is missing or malformed", async () => {
    mockOkResponse({ not_hourly: true });
    const result = await fetchVenueWeather(LAT, LNG, GAME_START_UTC);
    expect(result).toBeNull();
  });

  it("correctly handles a West Coast game whose UTC date is the day after local date", async () => {
    // LAA game at 7:38 PM Pacific on April 20 = 2026-04-21T02:38:00Z
    const gameStart = "2026-04-21T02:38:00Z";
    const payload = buildOpenMeteoPayload({
      times: Array.from({ length: 24 }, (_, i) => `2026-04-21T${String(i).padStart(2, "0")}:00`)
    });
    mockOkResponse(payload);

    const result = await fetchVenueWeather(LAT, LNG, gameStart);

    expect(result).not.toBeNull();
    // Confirm the URL includes the correct date (April 21, not April 20)
    expect(vi.mocked(fetchWithTimeout)).toHaveBeenCalledWith(
      expect.stringContaining("start_date=2026-04-21"),
      expect.anything()
    );
  });
});
