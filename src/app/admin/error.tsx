"use client";

import { Button } from "@/components/ui/button";

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md rounded-xl border bg-card p-8 text-center">
      <h1 className="text-lg font-semibold">Не удалось загрузить раздел</h1>
      <p className="mt-2 text-sm text-muted-foreground">Это временный сбой. Попробуйте обновить страницу.</p>
      <Button className="mt-5" onClick={reset}>
        Повторить
      </Button>
    </div>
  );
}
