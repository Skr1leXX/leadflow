import { cn } from "@/lib/utils";

export interface BarItem {
  label: string;
  count: number;
  /** Tailwind background class of the bar. */
  color?: string;
}

/** Horizontal bars with counts and shares: plain HTML, so values are readable by screen readers and testable. */
export function BarList({ items, total, empty = "Нет данных за выбранный период" }: { items: BarItem[]; total: number; empty?: string }) {
  if (items.every((i) => i.count === 0)) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{i.label}</span>
            <span className="shrink-0 tabular-nums">
              <b className="font-medium">{i.count}</b> <span className="text-xs text-muted-foreground">· {total ? Math.round((i.count / total) * 100) : 0}%</span>
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className={cn("h-full rounded-full", i.color ?? "bg-primary")} style={{ width: `${(i.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
