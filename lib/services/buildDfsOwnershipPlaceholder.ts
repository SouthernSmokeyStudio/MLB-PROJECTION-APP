import type { PlayerPosition } from "@lib/contracts/types";

export interface BuildDfsOwnershipPlaceholderInput {
  readonly position: PlayerPosition;
  readonly batting_order: number | null;
  readonly projected_points: number | null;
  readonly salary: number | null;
  readonly is_blocked: boolean;
}

export interface DfsOwnershipPlaceholderResult {
  readonly projected_ownership: number | null;
  readonly ownership_source: "placeholder";
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const roundToThousandths = (value: number): number => Math.round(value * 1000) / 1000;

export const buildDfsOwnershipPlaceholder = (
  input: BuildDfsOwnershipPlaceholderInput
): DfsOwnershipPlaceholderResult => {
  if (
    input.is_blocked ||
    input.projected_points === null ||
    input.salary === null ||
    !Number.isFinite(input.projected_points) ||
    !Number.isFinite(input.salary)
  ) {
    return {
      projected_ownership: null,
      ownership_source: "placeholder"
    };
  }

  const positionBase = input.position === "P" ? 0.12 : 0.04;
  const pointsBoost = clamp(input.projected_points / 110, 0, 0.18);
  const salaryBoost = clamp((input.salary - 2500) / 30000, 0, 0.14);
  const battingOrderBoost =
    input.position === "P" || input.batting_order === null
      ? 0
      : clamp((10 - input.batting_order) * 0.01, 0, 0.09);

  return {
    projected_ownership: roundToThousandths(
      clamp(positionBase + pointsBoost + salaryBoost + battingOrderBoost, 0, 1)
    ),
    ownership_source: "placeholder"
  };
};
