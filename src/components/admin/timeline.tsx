import { ArrowRightLeft, Bot, MessageSquare, PlusCircle, UserCheck } from "lucide-react";
import type { TimelineEntry, TimelineKind } from "@/features/leads/types";
import { dateTime } from "@/lib/format";

const ICON: Record<TimelineKind, typeof Bot> = {
  status: ArrowRightLeft,
  assignee: UserCheck,
  comment: MessageSquare,
  automation: Bot,
  created: PlusCircle,
};

function Line({ e }: { e: TimelineEntry }) {
  switch (e.kind) {
    case "comment":
      return (
        <>
          <p className="text-sm font-medium">{e.actorName}</p>
          <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{e.body}</p>
        </>
      );
    case "status":
      return (
        <p className="text-sm">
          Статус: <span className="text-muted-foreground">{e.from}</span> → <b className="font-medium">{e.to}</b> <span className="text-muted-foreground">· {e.actorName}</span>
        </p>
      );
    case "assignee":
      return (
        <p className="text-sm">
          Ответственный: <span className="text-muted-foreground">{e.from}</span> → <b className="font-medium">{e.to}</b> <span className="text-muted-foreground">· {e.actorName}</span>
        </p>
      );
    case "automation":
      return (
        <p className="text-sm">
          Автоматически назначен ответственный: <b className="font-medium">{e.to}</b> <span className="text-muted-foreground">· правило «{e.body}»</span>
        </p>
      );
    default:
      return (
        <p className="text-sm">
          {e.body} <span className="text-muted-foreground">· {e.actorName}</span>
        </p>
      );
  }
}

/** History and comments of one lead, newest first. `origin` is the synthetic "lead arrived" entry shown at the bottom. */
export function Timeline({ entries, origin }: { entries: TimelineEntry[]; origin?: { at: string; text: string } }) {
  const all = [...entries];
  return (
    <ol className="space-y-4">
      {all.map((e) => {
        const Icon = ICON[e.kind];
        return (
          <li key={e.id} className="flex gap-3">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <Line e={e} />
              <p className="mt-0.5 text-xs text-muted-foreground">{dateTime(e.at)}</p>
            </div>
          </li>
        );
      })}
      {origin && (
        <li className="flex gap-3">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <PlusCircle className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm">{origin.text}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{dateTime(origin.at)}</p>
          </div>
        </li>
      )}
    </ol>
  );
}
