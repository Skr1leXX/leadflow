import { addDaysTo, ymd } from "@/lib/format";
import { countLeadsInRange, leadRowsInRange } from "@/features/leads/repo";
import type { Db } from "@/features/leads/sql";
import { LEAD_STATUSES, type LeadStatus } from "@/features/leads/types";

export const PERIODS = ["week", "month", "quarter", "custom"] as const;
export type Period = (typeof PERIODS)[number];

/** Days covered by each preset, counting today. */
export const PRESET_DAYS = { week: 7, month: 30, quarter: 90 } as const;
export const MAX_CUSTOM_DAYS = 366;

export interface Range {
  /** Inclusive dates, "YYYY-MM-DD", Moscow time. */
  from: string;
  to: string;
  days: number;
}

export interface ResolvedPeriod {
  period: Period;
  range: Range;
  /** Set when the requested period was unusable and a default was applied instead. */
  note?: string;
}

const isDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDaysTo(s, 0) === s;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** Turns the URL's period choice into a concrete date range ending today. `today` is a Moscow date, "YYYY-MM-DD". */
export function resolveRange(input: { period?: string; from?: string; to?: string }, today: string): ResolvedPeriod {
  const preset = (p: keyof typeof PRESET_DAYS, note?: string): ResolvedPeriod => ({
    period: p,
    range: { from: addDaysTo(today, 1 - PRESET_DAYS[p]), to: today, days: PRESET_DAYS[p] },
    note,
  });

  if (input.period === "custom") {
    if (!isDay(input.from) || !isDay(input.to)) return preset("month", "Укажите обе даты периода. Показан последний месяц.");
    if (input.from > input.to) return preset("month", "Начало периода позже конца. Показан последний месяц.");
    const days = daysBetween(input.from, input.to);
    if (days > MAX_CUSTOM_DAYS) return preset("month", `Период длиннее ${MAX_CUSTOM_DAYS} дней. Показан последний месяц.`);
    return { period: "custom", range: { from: input.from, to: input.to, days } };
  }
  return preset(input.period === "week" || input.period === "quarter" ? input.period : "month");
}

export interface LeadRow {
  createdAt: string;
  status: LeadStatus;
  source: string;
  serviceId: string;
  demoData: boolean;
}

export interface Analytics {
  total: number;
  byStatus: Record<LeadStatus, number>;
  /** Won leads as a share of all leads in the period, percent with one decimal. */
  conversion: number;
  series: { day: string; label: string; leads: number }[];
  sources: { key: string; count: number }[];
  services: { key: string; count: number }[];
  /** How many of the counted leads are fictional demo leads. */
  demoCount: number;
}

const dayLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const ranked = (m: Map<string, number>) => [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

/** Every figure is derived from the given rows; nothing is estimated or filled in. */
export function computeAnalytics(rows: LeadRow[], range: Range): Analytics {
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  const sources = new Map<string, number>();
  const services = new Map<string, number>();
  const perDay = new Map<string, number>();
  let demoCount = 0;

  for (const r of rows) {
    byStatus[r.status]++;
    sources.set(r.source, (sources.get(r.source) ?? 0) + 1);
    services.set(r.serviceId, (services.get(r.serviceId) ?? 0) + 1);
    const day = ymd(r.createdAt);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    if (r.demoData) demoCount++;
  }

  const series = Array.from({ length: range.days }, (_, i) => {
    const day = addDaysTo(range.from, i);
    return { day, label: dayLabel.format(new Date(`${day}T00:00:00Z`)), leads: perDay.get(day) ?? 0 };
  });

  return { total: rows.length, byStatus, conversion: pct(byStatus.won, rows.length), series, sources: ranked(sources), services: ranked(services), demoCount };
}

export interface Dashboard extends Analytics {
  period: Period;
  range: Range;
  note?: string;
  /** Leads in the equally long period right before this one; the base for the change figure. */
  previousTotal: number;
  /** Change of the total against the previous period, percent; null when there is nothing to compare with. */
  delta: number | null;
  includeDemo: boolean;
  /** Demo leads in the period regardless of the filter, so the page can say what is being hidden. */
  demoInPeriod: number;
}

/** Loads the period's leads from the database and computes the dashboard. `now` decides what "today" is. */
export async function buildDashboard(db: Db, input: { period?: string; from?: string; to?: string; includeDemo: boolean }, now: Date): Promise<Dashboard> {
  const { period, range, note } = resolveRange(input, ymd(now));
  const rows = await leadRowsInRange(db, range.from, range.to, input.includeDemo);
  const analytics = computeAnalytics(rows, range);

  const prevTo = addDaysTo(range.from, -1);
  const previousTotal = await countLeadsInRange(db, addDaysTo(range.from, -range.days), prevTo, input.includeDemo);
  const demoInPeriod = input.includeDemo ? analytics.demoCount : (await countLeadsInRange(db, range.from, range.to, true)) - analytics.total;

  return {
    ...analytics,
    period,
    range,
    note,
    previousTotal,
    delta: previousTotal ? pct(analytics.total - previousTotal, previousTotal) : null,
    includeDemo: input.includeDemo,
    demoInPeriod,
  };
}
