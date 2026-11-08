import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Period } from "@/features/dashboard/analytics";
import { cn } from "@/lib/utils";

const PRESETS: { value: Exclude<Period, "custom">; label: string }[] = [
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "quarter", label: "Квартал" },
];

/** Period choice as plain links and a GET form: it works without JS and the period is shareable in the URL. */
export function PeriodPicker({ period, from, to, hideDemo }: { period: Period; from: string; to: string; hideDemo: boolean }) {
  const href = (p: string) => `/admin?period=${p}${hideDemo ? "&demo=hide" : ""}`;
  return (
    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div role="group" aria-label="Период" className="inline-flex w-fit rounded-lg border bg-card p-0.5">
        {PRESETS.map((p) => (
          <Link
            key={p.value}
            href={href(p.value)}
            aria-current={period === p.value ? "true" : undefined}
            className={cn("inline-flex h-10 min-w-24 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors", period === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {p.label}
          </Link>
        ))}
      </div>
      <form action="/admin" className="flex flex-wrap items-end gap-2" aria-label="Произвольный период">
        <input type="hidden" name="period" value="custom" />
        {hideDemo && <input type="hidden" name="demo" value="hide" />}
        <label className="space-y-1 text-xs text-muted-foreground">
          С
          <Input type="date" name="from" defaultValue={from} aria-label="Начало периода" className="h-10 text-foreground" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          По
          <Input type="date" name="to" defaultValue={to} aria-label="Конец периода" className="h-10 text-foreground" />
        </label>
        <Button type="submit" variant={period === "custom" ? "default" : "outline"} className="h-10">
          Показать период
        </Button>
      </form>
    </div>
  );
}
