import { Inbox } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        <Inbox className="size-5" />
      </div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-xs text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
