import type {
  DraftKingsClassicDraftGroup,
  DraftKingsClassicSalarySlate
} from "@lib/contracts/draftkings-classic";
import {
  asISOTimestamp,
  asPlayerId,
  err,
  ok,
  type ISOTimestamp,
  type Result
} from "@lib/contracts/types";

const DRAFTKINGS_API_HOST = "https://api.draftkings.com";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown, fieldName: string): Result<string, string> => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return err(`DraftKings Classic payload missing ${fieldName}`);
  }

  return ok(value);
};

const readNumber = (value: unknown, fieldName: string): Result<number, string> => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return err(`DraftKings Classic payload missing ${fieldName}`);
  }

  return ok(value);
};

const readBoolean = (value: unknown, fieldName: string): Result<boolean, string> => {
  if (typeof value !== "boolean") {
    return err(`DraftKings Classic payload missing ${fieldName}`);
  }

  return ok(value);
};

const readNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const parseDraftGroup = (
  value: unknown
): Result<DraftKingsClassicDraftGroup, string> => {
  if (!isRecord(value)) {
    return err("DraftKings Classic draft group must be an object");
  }

  const draftGroupId = readNumber(value.draftGroupId, "draftGroupId");
  if (!draftGroupId.success) {
    return draftGroupId;
  }

  const sportId = readNumber(value.sportId, "sportId");
  if (!sportId.success) {
    return sportId;
  }

  const contestTypeId = readNumber(value.contestTypeId, "contestTypeId");
  if (!contestTypeId.success) {
    return contestTypeId;
  }

  const gameTypeId = readNumber(value.gameTypeId, "gameTypeId");
  if (!gameTypeId.success) {
    return gameTypeId;
  }

  const draftGroupState = readString(value.draftGroupState, "draftGroupState");
  if (!draftGroupState.success) {
    return draftGroupState;
  }

  const sortOrder = readNumber(value.sortOrder, "sortOrder");
  if (!sortOrder.success) {
    return sortOrder;
  }

  const minStartTime = readString(value.minStartTime, "minStartTime");
  if (!minStartTime.success) {
    return minStartTime;
  }

  const maxStartTime = readString(value.maxStartTime, "maxStartTime");
  if (!maxStartTime.success) {
    return maxStartTime;
  }

  const allowLineupCreation = readBoolean(
    value.allowLineupCreation,
    "allowLineupCreation"
  );
  if (!allowLineupCreation.success) {
    return allowLineupCreation;
  }

  const allTags = Array.isArray(value.allTags)
    ? value.allTags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const competitionIds = Array.isArray(value.competitionIds)
    ? value.competitionIds
        .filter((competitionId): competitionId is number => typeof competitionId === "number")
        .map(String)
    : [];

  return ok({
    draft_group_id: String(draftGroupId.data),
    sport_id: sportId.data,
    contest_type_id: contestTypeId.data,
    game_type_id: gameTypeId.data,
    draft_group_state: draftGroupState.data,
    sort_order: sortOrder.data,
    start_time_suffix: readNullableString(value.startTimeSuffix),
    min_start_time: asISOTimestamp(minStartTime.data),
    max_start_time: asISOTimestamp(maxStartTime.data),
    allow_lineup_creation: allowLineupCreation.data,
    all_tags: allTags,
    competition_ids: competitionIds
  });
};

const parseSalaryEntry = (
  value: unknown
): Result<DraftKingsClassicSalarySlate["salaries"][number], string> => {
  if (!isRecord(value)) {
    return err("DraftKings Classic draftable must be an object");
  }

  const draftableId = readNumber(value.draftableId, "draftableId");
  if (!draftableId.success) {
    return draftableId;
  }

  const playerId = readNumber(value.playerId, "playerId");
  if (!playerId.success) {
    return playerId;
  }

  const playerDkId = readNumber(value.playerDkId, "playerDkId");
  if (!playerDkId.success) {
    return playerDkId;
  }

  const displayName = readString(value.displayName, "displayName");
  if (!displayName.success) {
    return displayName;
  }

  const shortName = readString(value.shortName, "shortName");
  if (!shortName.success) {
    return shortName;
  }

  const position = readString(value.position, "position");
  if (!position.success) {
    return position;
  }

  const rosterSlotId = readNumber(value.rosterSlotId, "rosterSlotId");
  if (!rosterSlotId.success) {
    return rosterSlotId;
  }

  const salary = readNumber(value.salary, "salary");
  if (!salary.success) {
    return salary;
  }

  const teamAbbreviation = readString(value.teamAbbreviation, "teamAbbreviation");
  if (!teamAbbreviation.success) {
    return teamAbbreviation;
  }

  const competition = value.competition;
  if (!isRecord(competition)) {
    return err("DraftKings Classic draftable missing competition");
  }

  const competitionId = readNumber(competition.competitionId, "competition.competitionId");
  if (!competitionId.success) {
    return competitionId;
  }

  const competitionName = readString(competition.name, "competition.name");
  if (!competitionName.success) {
    return competitionName;
  }

  const competitionStart = readString(competition.startTime, "competition.startTime");
  if (!competitionStart.success) {
    return competitionStart;
  }

  return ok({
    draftable_id: String(draftableId.data),
    player_id: asPlayerId(String(playerId.data)),
    player_dk_id: String(playerDkId.data),
    display_name: displayName.data,
    short_name: shortName.data,
    position: position.data,
    roster_slot_id: rosterSlotId.data,
    salary: salary.data,
    team_abbreviation: teamAbbreviation.data,
    competition_id: String(competitionId.data),
    competition_name: competitionName.data,
    competition_start: asISOTimestamp(competitionStart.data)
  });
};

export const parseDraftKingsClassicSalarySlate = ({
  draftGroupId,
  fetchedAt,
  payload
}: {
  readonly draftGroupId: string;
  readonly fetchedAt: ISOTimestamp;
  readonly payload: unknown;
}): Result<DraftKingsClassicSalarySlate, string> => {
  if (!isRecord(payload)) {
    return err("DraftKings Classic salary response must be an object");
  }

  if (!Array.isArray(payload.draftables)) {
    return err("DraftKings Classic salary response missing draftables");
  }

  const salaries: DraftKingsClassicSalarySlate["salaries"][number][] = [];

  for (const draftable of payload.draftables) {
    const parsed = parseSalaryEntry(draftable);

    if (!parsed.success) {
      return parsed;
    }

    salaries.push(parsed.data);
  }

  return ok({
    provider: "draftkings",
    contest_type: "classic",
    draft_group_id: draftGroupId,
    source: {
      provider: "draftkings",
      endpoint: `${DRAFTKINGS_API_HOST}/draftgroups/v1/draftgroups/${draftGroupId}/draftables?format=json`,
      fetched_at: fetchedAt,
      raw_payload_hash: null
    },
    salaries
  });
};

export const parseUpcomingDraftKingsClassicDraftGroups = (
  payload: unknown
): Result<readonly DraftKingsClassicDraftGroup[], string> => {
  if (!isRecord(payload)) {
    return err("DraftKings Classic draft group response must be an object");
  }

  if (!Array.isArray(payload.draftGroups)) {
    return err("DraftKings Classic draft group response missing draftGroups");
  }

  const groups: DraftKingsClassicDraftGroup[] = [];

  for (const draftGroup of payload.draftGroups) {
    const parsed = parseDraftGroup(draftGroup);

    if (!parsed.success) {
      return parsed;
    }

    groups.push(parsed.data);
  }

  return ok(groups);
};

export const fetchUpcomingDraftKingsClassicDraftGroups = async (): Promise<
  Result<readonly DraftKingsClassicDraftGroup[], string>
> => {
  const endpoint =
    `${DRAFTKINGS_API_HOST}/sites/US-DK/draftgroups/v3/draftgroups?states=upcoming&format=json`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    return err(`DraftKings Classic draft group request failed with status ${response.status}`);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return err("DraftKings Classic draft group response was not valid JSON");
  }

  return parseUpcomingDraftKingsClassicDraftGroups(payload);
};

export const fetchDraftKingsClassicSalarySlate = async (
  draftGroupId: string
): Promise<Result<DraftKingsClassicSalarySlate, string>> => {
  const fetchedAt = asISOTimestamp(new Date().toISOString());
  const endpoint = `${DRAFTKINGS_API_HOST}/draftgroups/v1/draftgroups/${draftGroupId}/draftables?format=json`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    return err(`DraftKings Classic salary request failed with status ${response.status}`);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    return err("DraftKings Classic salary response was not valid JSON");
  }

  return parseDraftKingsClassicSalarySlate({
    draftGroupId,
    fetchedAt,
    payload
  });
};
