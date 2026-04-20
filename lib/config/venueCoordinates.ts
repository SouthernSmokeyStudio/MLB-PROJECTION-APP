// Venue coordinates keyed by MLB Stats API home team integer ID.
//
// Used to fetch pre-game weather forecasts from Open-Meteo when the
// MLB Stats API does not yet have live weather for a scheduled game.
//
// Coordinates: WGS84 lat/lng for the ballpark entrance/field centroid.
//
// is_always_dome: true for fixed-dome venues only (Tropicana Field).
//   Retractable-roof stadiums use is_always_dome: false — a forecast is
//   still fetched because the roof status is unknown until game time.
//   When MLB live weather later confirms "Roof Closed", dome_closed
//   updates to true via the existing buildWeather path.
//
// Key: MLB Stats API integer team ID (same IDs in TEAM_METADATA).

export interface VenueCoordinates {
  readonly lat: number;
  readonly lng: number;
  readonly is_always_dome: boolean;
}

export const VENUE_COORDINATES_BY_TEAM: Readonly<Record<number, VenueCoordinates>> = {
  108: { lat: 33.8003, lng: -117.8827, is_always_dome: false }, // LAA – Angel Stadium
  109: { lat: 33.4453, lng: -112.0667, is_always_dome: false }, // ARI – Chase Field (retractable)
  110: { lat: 39.2838, lng: -76.6216,  is_always_dome: false }, // BAL – Oriole Park at Camden Yards
  111: { lat: 42.3467, lng: -71.0972,  is_always_dome: false }, // BOS – Fenway Park
  112: { lat: 41.9484, lng: -87.6553,  is_always_dome: false }, // CHC – Wrigley Field
  113: { lat: 39.0978, lng: -84.5080,  is_always_dome: false }, // CIN – Great American Ball Park
  114: { lat: 41.4962, lng: -81.6852,  is_always_dome: false }, // CLE – Progressive Field
  115: { lat: 39.7559, lng: -104.9942, is_always_dome: false }, // COL – Coors Field
  116: { lat: 42.3390, lng: -83.0485,  is_always_dome: false }, // DET – Comerica Park
  117: { lat: 29.7573, lng: -95.3555,  is_always_dome: false }, // HOU – Daikin Park (retractable)
  118: { lat: 39.0514, lng: -94.4803,  is_always_dome: false }, // KC  – Kauffman Stadium
  119: { lat: 34.0739, lng: -118.2400, is_always_dome: false }, // LAD – Dodger Stadium
  120: { lat: 38.8730, lng: -77.0074,  is_always_dome: false }, // WSH – Nationals Park
  121: { lat: 40.7569, lng: -73.8455,  is_always_dome: false }, // NYM – Citi Field
  133: { lat: 38.5801, lng: -121.5003, is_always_dome: false }, // ATH – Sutter Health Park
  134: { lat: 40.4469, lng: -80.0057,  is_always_dome: false }, // PIT – PNC Park
  135: { lat: 32.7076, lng: -117.1570, is_always_dome: false }, // SD  – Petco Park
  136: { lat: 47.5914, lng: -122.3323, is_always_dome: false }, // SEA – T-Mobile Park (retractable)
  137: { lat: 37.7786, lng: -122.3893, is_always_dome: false }, // SF  – Oracle Park
  138: { lat: 38.6226, lng: -90.1928,  is_always_dome: false }, // STL – Busch Stadium
  139: { lat: 27.7683, lng: -82.6534,  is_always_dome: true  }, // TB  – Tropicana Field (fixed dome)
  140: { lat: 32.7510, lng: -97.0831,  is_always_dome: false }, // TEX – Globe Life Field (retractable)
  141: { lat: 43.6414, lng: -79.3894,  is_always_dome: false }, // TOR – Rogers Centre (retractable)
  142: { lat: 44.9817, lng: -93.2781,  is_always_dome: false }, // MIN – Target Field
  143: { lat: 39.9058, lng: -75.1665,  is_always_dome: false }, // PHI – Citizens Bank Park
  144: { lat: 33.8908, lng: -84.4678,  is_always_dome: false }, // ATL – Truist Park
  145: { lat: 41.8300, lng: -87.6338,  is_always_dome: false }, // CWS – Guaranteed Rate Field
  146: { lat: 25.7781, lng: -80.2197,  is_always_dome: false }, // MIA – loanDepot park (retractable)
  147: { lat: 40.8296, lng: -73.9262,  is_always_dome: false }, // NYY – Yankee Stadium
  158: { lat: 43.0283, lng: -87.9711,  is_always_dome: false }, // MIL – American Family Field (retractable)
} as const;
