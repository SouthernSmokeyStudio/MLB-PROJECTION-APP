export interface ErrorRow {
  readonly projected: number | null;
  readonly actual: number | null;
  readonly skipped?: boolean;
}

export interface NumericErrorMetrics {
  readonly mae: number | null;
  readonly bias: number | null;
  readonly evaluated_count: number;
  readonly skipped_count: number;
}

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

export const computeMae = (rows: readonly ErrorRow[]): number | null => {
  const valid = rows.filter((row) => !row.skipped && row.projected !== null && row.actual !== null);
  if (valid.length === 0) {
    return null;
  }

  const total = valid.reduce((sum, row) => sum + Math.abs(row.projected! - row.actual!), 0);
  return round4(total / valid.length);
};

export const computeBias = (rows: readonly ErrorRow[]): number | null => {
  const valid = rows.filter((row) => !row.skipped && row.projected !== null && row.actual !== null);
  if (valid.length === 0) {
    return null;
  }

  const total = valid.reduce((sum, row) => sum + (row.projected! - row.actual!), 0);
  return round4(total / valid.length);
};

export const countEvaluated = (rows: readonly ErrorRow[]): number =>
  rows.filter((row) => !row.skipped && row.projected !== null && row.actual !== null).length;

export const countSkipped = (rows: readonly ErrorRow[]): number =>
  rows.filter((row) => row.skipped || row.projected === null || row.actual === null).length;

export const summarizeErrorMetrics = (rows: readonly ErrorRow[]): NumericErrorMetrics => ({
  mae: computeMae(rows),
  bias: computeBias(rows),
  evaluated_count: countEvaluated(rows),
  skipped_count: countSkipped(rows)
});
