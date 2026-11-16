/**
 * Calculates upcoming execution timestamps for 5-part and 6-part cron expressions.
 * Zero external runtime dependencies.
 */
export function getNextCronRuns(expression: string, count: number = 5): Date[] {
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return [];
  }

  // Normalize: if 6 parts (with seconds or year), shift or handle standard 5 parts
  const hasSeconds = parts.length === 6 && /^[0-9*]/.test(parts[0]);
  const [minPart, hourPart, domPart, monthPart, dowPart] = hasSeconds
    ? [parts[1], parts[2], parts[3], parts[4], parts[5]]
    : [parts[0], parts[1], parts[2], parts[3], parts[4]];

  const matchField = (val: number, expr: string, isDow: boolean = false): boolean => {
    if (expr === '*' || expr === '?') return true;

    // Handle day of week names
    const dowMap: Record<string, number> = {
      SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
    };
    let normalized = expr.toUpperCase();
    for (const [name, num] of Object.entries(dowMap)) {
      normalized = normalized.replace(new RegExp(name, 'g'), num.toString());
    }

    // Comma-separated lists (e.g. 1,15,30)
    if (normalized.includes(',')) {
      return normalized.split(',').some((sub) => matchField(val, sub, isDow));
    }

    // Step values (e.g. */5, 10-20/2)
    if (normalized.includes('/')) {
      const [range, stepStr] = normalized.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) return false;

      if (range === '*') {
        return val % step === 0;
      }
      const start = parseInt(range, 10);
      return !isNaN(start) && val >= start && (val - start) % step === 0;
    }

    // Range (e.g. 1-5, 9-17)
    if (normalized.includes('-')) {
      const [startStr, endStr] = normalized.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      return !isNaN(start) && !isNaN(end) && val >= start && val <= end;
    }

    const exact = parseInt(normalized, 10);
    if (isDow && exact === 7) return val === 0; // 7 can represent Sunday
    return val === exact;
  };

  const results: Date[] = [];
  const current = new Date();
  // Start at the next whole minute
  current.setSeconds(0, 0);
  current.setMinutes(current.getMinutes() + 1);

  // Search forward up to 60 days
  const maxIterations = 60 * 24 * 60; // 86,400 minutes
  let iterations = 0;

  while (results.length < count && iterations < maxIterations) {
    const min = current.getMinutes();
    const hour = current.getHours();
    const dom = current.getDate();
    const month = current.getMonth() + 1; // 1-12
    const dow = current.getDay(); // 0-6 (Sun-Sat)

    if (
      matchField(month, monthPart) &&
      matchField(dom, domPart) &&
      matchField(dow, dowPart, true) &&
      matchField(hour, hourPart) &&
      matchField(min, minPart)
    ) {
      results.push(new Date(current.getTime()));
    }

    // Advance 1 minute
    current.setMinutes(current.getMinutes() + 1);
    iterations++;
  }

  return results;
}

/**
 * Formats upcoming dates into a readable schedule bullet list.
 */
export function formatUpcomingDates(dates: Date[]): string {
  if (dates.length === 0) {
    return '*Unable to compute upcoming runs for this expression.*';
  }

  return dates
    .map((d, index) => {
      const dateStr = d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const timeStr = d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
      return `${index + 1}. **${dateStr}** at \`${timeStr}\``;
    })
    .join('\n');
}
