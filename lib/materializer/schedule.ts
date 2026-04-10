/**
 * schedule.ts
 *
 * Materialization schedule configuration.
 *
 * These are the canonical run times for scheduled materialization.
 * The CLI entry point reads this config.  Deployment-level cron wiring
 * (systemd, Cloud Scheduler, GitHub Actions, etc.) is outside this repo.
 *
 * All times are in America/Chicago (Central Time):
 *   00:00 — overnight baseline for next-day games
 *   05:00 — early-morning refresh after overnight roster moves
 *   12:00 — midday refresh with latest projected lineups
 *   17:00 — pre-game refresh before evening slate
 */

export interface ScheduleEntry {
  /** Hour in 24h format (America/Chicago). */
  readonly hour: number;
  /** Minute. */
  readonly minute: number;
  /** Human-readable label for logging. */
  readonly label: string;
}

export const MATERIALIZATION_SCHEDULE: readonly ScheduleEntry[] = [
  { hour: 0, minute: 0, label: "overnight-baseline" },
  { hour: 5, minute: 0, label: "early-morning-refresh" },
  { hour: 12, minute: 0, label: "midday-refresh" },
  { hour: 17, minute: 0, label: "pre-game-refresh" }
] as const;

export const MATERIALIZATION_TIMEZONE = "America/Chicago" as const;

/**
 * Format schedule entries as cron expressions (for documentation / external wiring).
 * Each returns "minute hour * * *" in the configured timezone.
 */
export const scheduleToCronExpressions = (): readonly string[] =>
  MATERIALIZATION_SCHEDULE.map((e) => `${e.minute} ${e.hour} * * *`);

/**
 * Get the date string (YYYY-MM-DD) for the current moment in the
 * configured timezone.
 */
export const getDateInScheduleTimezone = (): string => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MATERIALIZATION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
};
