import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AccessDenied() {
  return (
    <div role="alert" className="mx-auto mt-12 max-w-md rounded-xl border bg-card p-8 text-center">
      <ShieldAlert className="mx-auto size-8 text-destructive" />
      <h1 className="mt-3 text-lg font-semibold">Недостаточно прав</h1>
      <p className="mt-2 text-sm text-muted-foreground">Этот раздел доступен только администратору. Если он нужен вам для работы, попросите выдать доступ.</p>
      <Button className="mt-5" nativeButton={false} render={<Link href="/admin" />}>
        На главную панели
      </Button>
    </div>
  );
}
