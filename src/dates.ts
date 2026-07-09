// Grounding natural-language deadlines against a message's own timestamp.
//
// The extractor's old stub returned "observedAt + 3 days" for every deadline
// word, which meant "by Friday" and "tomorrow" resolved to the same instant and
// contradicted the demo. This module does it for real: it reads phrases like
// "by Friday", "EOD", "tomorrow", "next week", "by 5pm Monday" and resolves them
// to a concrete epoch-ms deadline, anchored to when the message was observed and
// the workspace timezone.
//
// It is pure and deterministic: no Date.now(), no host-timezone dependence. It
// derives local calendar fields from the passed-in epoch ms plus a fixed UTC
// offset, so the same inputs always produce the same output (which is what makes
// it unit-testable and what the deterministic-ledger thesis needs).

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** Default clock time (local hour) for a day-granularity deadline like "Friday". */
const DEFAULT_DUE_HOUR = 17; // 5pm local

interface LocalParts {
  year: number;
  month: number; // 0-11
  day: number;
  weekday: number; // 0=Sun
}

/** Local calendar parts for an instant, given a fixed offset (minutes east of UTC). */
function localParts(epochMs: number, tzOffsetMinutes: number): LocalParts {
  const d = new Date(epochMs + tzOffsetMinutes * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
}

/** Build an epoch-ms instant from local calendar parts + a fixed offset. */
function fromLocal(p: LocalParts, hour: number, minute: number, tzOffsetMinutes: number): number {
  return Date.UTC(p.year, p.month, p.day, hour, minute) - tzOffsetMinutes * 60_000;
}

/** Add whole days to a local date, normalizing via UTC math. */
function addDays(p: LocalParts, n: number): LocalParts {
  // Work in UTC space anchored to the local calendar day. Since we only shift by
  // whole days, DST-style offset wobble never applies here.
  const d = new Date(Date.UTC(p.year, p.month, p.day) + n * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay() };
}

/** Parse an explicit clock time from text, e.g. "5pm", "9:30am", "17:00". */
function parseClock(text: string): { hour: number; minute: number } | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m) {
    let hour = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) hour += 12;
    return { hour, minute: m[2] ? parseInt(m[2], 10) : 0 };
  }
  const m24 = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m24) {
    const hour = parseInt(m24[1], 10);
    const minute = parseInt(m24[2], 10);
    if (hour <= 23 && minute <= 59) return { hour, minute };
  }
  return null;
}

/**
 * Resolve a deadline expressed in `text` to an epoch-ms instant, anchored to
 * `observedAt` and the workspace `tzOffsetMinutes`. Returns null when no
 * deadline can be grounded (the loop then simply has no due date, which is a
 * valid state — an unowned request escalates on the response SLA, not a deadline).
 */
export function groundDeadline(text: string, observedAt: number, tzOffsetMinutes = 0): number | null {
  const t = text.toLowerCase();
  const today = localParts(observedAt, tzOffsetMinutes);
  const clock = parseClock(t);
  const atHour = clock?.hour ?? DEFAULT_DUE_HOUR;
  const atMin = clock?.minute ?? 0;

  // End-of-day synonyms => today at close of business.
  if (/\b(eod|cob|end of (the )?day|close of business|by end of day|by eod|by cob)\b/.test(t)) {
    return fromLocal(today, 18, 0, tzOffsetMinutes);
  }

  if (/\btoday\b|\btonight\b|\bthis (afternoon|evening|morning)\b/.test(t)) {
    return fromLocal(today, atHour, atMin, tzOffsetMinutes);
  }

  if (/\btomorrow\b/.test(t)) {
    return fromLocal(addDays(today, 1), atHour, atMin, tzOffsetMinutes);
  }

  if (/\bnext week\b/.test(t)) {
    // Following Monday.
    const daysToNextMonday = ((8 - today.weekday) % 7) || 7;
    return fromLocal(addDays(today, daysToNextMonday), atHour, atMin, tzOffsetMinutes);
  }

  const inDays = t.match(/\bin (\d{1,2}) days?\b/) ?? t.match(/\b(\d{1,2}) days? (from now|out)\b/);
  if (inDays) {
    return fromLocal(addDays(today, parseInt(inDays[1], 10)), atHour, atMin, tzOffsetMinutes);
  }

  // A named weekday => the next occurrence at or after today. "Friday" said on a
  // Friday means today; otherwise the coming Friday.
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    const re = new RegExp(`\\b(by |before |on |this |next )?${name}\\b`);
    if (re.test(t)) {
      const isNext = new RegExp(`\\bnext ${name}\\b`).test(t);
      let delta = (dow - today.weekday + 7) % 7;
      if (isNext) delta += 7; // "next Friday" is always a week out
      return fromLocal(addDays(today, delta), atHour, atMin, tzOffsetMinutes);
    }
  }

  // A bare clock time with no day => today at that time.
  if (clock) {
    return fromLocal(today, atHour, atMin, tzOffsetMinutes);
  }

  return null;
}
