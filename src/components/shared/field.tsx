import { Label } from "@/components/ui/label";

/** Label + control + error text. `error` is announced through aria-describedby on the control (see `errorId`). */
export const errorId = (name: string) => `${name}-error`;

export function Field({
  name,
  label,
  error,
  hint,
  children,
}: {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {error ? (
        <p id={errorId(name)} className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export const nativeSelectClass =
  "h-8 w-full rounded-lg border border-input bg-card px-2.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";
