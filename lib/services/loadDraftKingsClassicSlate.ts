import {
  fetchDraftKingsClassicSalarySlate,
  fetchUpcomingDraftKingsClassicDraftGroups
} from "@lib/adapters/draftKings";
import type {
  DraftKingsClassicDraftGroup,
  DraftKingsClassicSalarySlate
} from "@lib/contracts/draftkings-classic";
import { ok, err, type Result } from "@lib/contracts/types";

const MLB_SPORT_ID = 2;
const DRAFTKINGS_CLASSIC_CONTEST_TYPE_ID = 28;
const DRAFTKINGS_CLASSIC_GAME_TYPE_ID = 2;

export interface LoadedDraftKingsClassicSlate {
  readonly source: "draftkings-classic-live";
  readonly date: string;
  readonly generated_at: string;
  readonly draft_group: DraftKingsClassicDraftGroup | null;
  readonly label: string | null;
  readonly salary_slate: DraftKingsClassicSalarySlate | null;
  readonly note: string | null;
}

const isDraftKingsClassicGroup = (group: DraftKingsClassicDraftGroup): boolean =>
  group.sport_id === MLB_SPORT_ID &&
  group.contest_type_id === DRAFTKINGS_CLASSIC_CONTEST_TYPE_ID &&
  group.game_type_id === DRAFTKINGS_CLASSIC_GAME_TYPE_ID &&
  group.allow_lineup_creation;

const buildDraftKingsClassicLabel = (
  draftGroup: DraftKingsClassicDraftGroup
): string => {
  const featuredPrefix = draftGroup.all_tags.includes("Featured") ? "Featured " : "";
  const suffix = draftGroup.start_time_suffix ?? "";
  return `${featuredPrefix}DraftKings Classic${suffix}`;
};

const selectDraftKingsClassicGroup = ({
  date,
  draftGroupId,
  groups
}: {
  readonly date: string;
  readonly draftGroupId?: string;
  readonly groups: readonly DraftKingsClassicDraftGroup[];
}): DraftKingsClassicDraftGroup | null => {
  if (draftGroupId) {
    return (
      groups.find(
        (group) =>
          group.draft_group_id === draftGroupId &&
          isDraftKingsClassicGroup(group) &&
          group.min_start_time.slice(0, 10) === date
      ) ?? null
    );
  }

  return [...groups]
    .filter(
      (group) =>
        isDraftKingsClassicGroup(group) &&
        group.min_start_time.slice(0, 10) === date
    )
    .sort((left, right) => {
      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order;
      }

      return left.min_start_time.localeCompare(right.min_start_time);
    })[0] ?? null;
};

export const loadDraftKingsClassicSlate = async ({
  date,
  draftGroupId
}: {
  readonly date: string;
  readonly draftGroupId?: string;
}): Promise<Result<LoadedDraftKingsClassicSlate, string>> => {
  const generatedAt = new Date().toISOString();
  const fetchedGroups = await fetchUpcomingDraftKingsClassicDraftGroups();

  if (!fetchedGroups.success) {
    return err(fetchedGroups.error);
  }

  const selectedGroup = selectDraftKingsClassicGroup(
    draftGroupId
      ? {
          date,
          draftGroupId,
          groups: fetchedGroups.data
        }
      : {
          date,
          groups: fetchedGroups.data
        }
  );

  if (!selectedGroup) {
    return ok({
      source: "draftkings-classic-live",
      date,
      generated_at: generatedAt,
      draft_group: null,
      label: null,
      salary_slate: null,
      note: draftGroupId
        ? `DraftKings Classic draft group ${draftGroupId} was not available.`
        : "No DraftKings Classic salary slate matched the requested date."
    });
  }

  const fetchedSlate = await fetchDraftKingsClassicSalarySlate(
    selectedGroup.draft_group_id
  );

  if (!fetchedSlate.success) {
    return err(fetchedSlate.error);
  }

  return ok({
    source: "draftkings-classic-live",
    date,
    generated_at: generatedAt,
    draft_group: selectedGroup,
    label: buildDraftKingsClassicLabel(selectedGroup),
    salary_slate: fetchedSlate.data,
    note: null
  });
};
