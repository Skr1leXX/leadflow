import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  /** Percent change; omit when there is nothing to compare against. */
  delta?: number | null;
  hint: string;
}) {
  const up = (delta ?? 0) >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <Card>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {delta != null && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
                up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
              )}
            >
              <Icon className="size-3" />
              {Math.abs(delta).toString().replace(".", ",")}%
            </span>
          )}
          {hint}
        </p>
      </CardContent>
    </Card>
  );
}
