import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/10 text-destructive",
} as const;

export type Tone = keyof typeof tones;

export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <Badge variant="secondary" className={cn("border-0 font-medium", tones[tone])}>
      {children}
    </Badge>
  );
}
