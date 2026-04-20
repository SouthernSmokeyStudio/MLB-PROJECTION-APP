// Open-Meteo forecast adapter.
//
// Fetches hourly weather for a given lat/lng on the game date and
// returns a WeatherSummary for the hour closest to game start time.
//
// Open-Meteo is free, requires no API key, and covers the full MLB
// schedule window (up to 16 days out).
//
// Limitations:
//   - Wind direction is a compass string ("NE", "SW", etc.) derived
//     from degrees; park-relative direction ("Out to RF") is not possible.
//   - dome_closed is always null from this source — only MLB Stats API
//     live weather can confirm roof status at game time.

import { fetchWithTimeout } from "./fetchWithTimeout";
import type { WeatherSummary } from "@lib/contracts/types";

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

const WMO_CODE_CONDITIONS: ReadonlyArray<readonly [ReadonlyArray<number>, string]> = [
  [[0], "Clear"],
  [[1], "Mostly Clear"],
  [[2], "Partly Cloudy"],
  [[3], "Overcast"],
  [[45, 48], "Foggy"],
  [[51, 53, 55], "Drizzle"],
  [[56, 57], "Freezing Drizzle"],
  [[61, 63, 65], "Rain"],
  [[66, 67], "Freezing Rain"],
  [[71, 73, 75, 77], "Snow"],
  [[80, 81, 82], "Showers"],
  [[85, 86], "Snow Showers"],
  [[95], "Thunderstorm"],
  [[96, 99], "Severe Thunderstorm"],
];

const wmoToConditions = (code: number): string | null => {
  for (const [codes, label] of WMO_CODE_CONDITIONS) {
    if ((codes as number[]).includes(code)) return label;
  }
  return null;
};

// WMO wind-from-degrees → 8-point compass.
// 0° = N, 45° = NE, 90° = E, etc.
const degreesToCompass = (deg: number): string => {
  const dirs: readonly string[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx] ?? "N";
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Fetches the Open-Meteo forecast for a venue and returns a WeatherSummary
 * matched to the hour of `gameStartUtc`.
 *
 * Returns null when:
 *   - The fetch fails or times out
 *   - The response is not parseable
 *   - No hourly slot matches the game start hour
 */
export const fetchVenueWeather = async (
  lat: number,
  lng: number,
  gameStartUtc: string // ISO timestamp, e.g. "2026-04-20T23:40:00Z"
): Promise<WeatherSummary | null> => {
  const date = gameStartUtc.slice(0, 10);

  const searchParams = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly:
      "temperature_2m,precipitation_probability,windspeed_10m,winddirection_10m,weathercode",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "UTC",
    start_date: date,
    end_date: date,
  });

  const result = await fetchWithTimeout(
    `${OPEN_METEO_ENDPOINT}?${searchParams.toString()}`
  );

  if (result.response === null || !result.response.ok) return null;

  let payload: unknown;
  try {
    payload = await result.response.json();
  } catch {
    return null;
  }

  if (!isRecord(payload)) return null;
  const hourly = payload["hourly"];
  if (!isRecord(hourly)) return null;

  const times = hourly["time"];
  const temperatures = hourly["temperature_2m"];
  const precipProbs = hourly["precipitation_probability"];
  const windSpeeds = hourly["windspeed_10m"];
  const windDirs = hourly["winddirection_10m"];
  const weatherCodes = hourly["weathercode"];

  if (
    !Array.isArray(times) ||
    !Array.isArray(temperatures) ||
    !Array.isArray(windSpeeds) ||
    !Array.isArray(windDirs) ||
    !Array.isArray(weatherCodes)
  ) {
    return null;
  }

  // Match by UTC hour prefix: "2026-04-20T23:40:00Z" → "2026-04-20T23"
  const gameHour = gameStartUtc.slice(0, 13);
  const idx = (times as string[]).findIndex((t) => t.startsWith(gameHour));
  if (idx === -1) return null;

  const rawTemp = temperatures[idx];
  const rawWindSpeed = windSpeeds[idx];
  const rawWindDir = windDirs[idx];
  const rawCode = weatherCodes[idx];

  const temp = typeof rawTemp === "number" ? rawTemp : null;
  const windSpeed = typeof rawWindSpeed === "number" ? rawWindSpeed : null;
  const windDirDeg = typeof rawWindDir === "number" ? rawWindDir : null;
  const weatherCode = typeof rawCode === "number" ? rawCode : null;

  let precipChance: number | null = null;
  if (Array.isArray(precipProbs)) {
    const rawPrec = precipProbs[idx];
    precipChance = typeof rawPrec === "number" ? rawPrec / 100 : null;
  }

  return {
    temperature_f: temp !== null ? Math.round(temp * 10) / 10 : null,
    wind_speed_mph: windSpeed !== null ? Math.round(windSpeed * 10) / 10 : null,
    wind_direction: windDirDeg !== null ? degreesToCompass(windDirDeg) : null,
    precipitation_chance: precipChance,
    conditions: weatherCode !== null ? wmoToConditions(weatherCode) : null,
    dome_closed: null, // only MLB live weather can confirm roof status
  };
};
