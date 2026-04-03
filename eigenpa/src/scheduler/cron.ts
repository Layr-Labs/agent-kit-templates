/**
 * Minimal cron expression parser.
 * Supports: minute hour day-of-month month day-of-week
 * Each field supports: number, *, and step (e.g., *​/5)
 */

interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

function parseField(field: string, min: number, max: number): number[] {
  if (field === "*") {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  // Step: */n
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    const values: number[] = [];
    for (let i = min; i <= max; i += step) {
      values.push(i);
    }
    return values;
  }

  // Comma-separated: 1,5,10
  if (field.includes(",")) {
    return field.split(",").map((v) => parseInt(v, 10));
  }

  // Range: 1-5
  if (field.includes("-")) {
    const [start, end] = field.split("-").map((v) => parseInt(v, 10));
    const values: number[] = [];
    for (let i = start; i <= end; i++) {
      values.push(i);
    }
    return values;
  }

  // Single number
  return [parseInt(field, 10)];
}

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression: expected 5 fields, got ${parts.length}`
    );
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

/**
 * Check if a cron expression matches a given date.
 */
export function cronMatches(expression: string, date: Date): boolean {
  const fields = parseCron(expression);
  return (
    fields.minute.includes(date.getMinutes()) &&
    fields.hour.includes(date.getHours()) &&
    fields.dayOfMonth.includes(date.getDate()) &&
    fields.month.includes(date.getMonth() + 1) &&
    fields.dayOfWeek.includes(date.getDay())
  );
}

/**
 * Compute the next run time for a cron expression after the given date.
 * Scans forward minute-by-minute up to 366 days.
 */
export function nextRunTime(expression: string, after: Date): Date {
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxIterations = 366 * 24 * 60; // 1 year of minutes
  for (let i = 0; i < maxIterations; i++) {
    if (cronMatches(expression, candidate)) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`No next run found for: ${expression}`);
}
