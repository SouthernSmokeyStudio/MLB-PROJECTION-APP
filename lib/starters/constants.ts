export const STARTER_SOURCE_TIERS = ["official", "projected", "reported", "inferred"] as const;
export const STARTER_STATUSES = ["confirmed", "projected", "reported", "unknown"] as const;
export const STARTER_FRESHNESS_STATUSES = ["fresh", "stale", "unknown"] as const;
export const STARTER_SOURCE_TYPES = ["official", "projected", "reported"] as const;

export const STARTER_INTELLIGENCE_TABLE = "game_starter_intelligence" as const;
export const STARTER_SOURCES_TABLE = "starter_sources" as const;
