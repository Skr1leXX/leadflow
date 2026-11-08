import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";

export function UserAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar className={className}>
      <AvatarFallback className="bg-accent text-xs font-medium text-accent-foreground">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
