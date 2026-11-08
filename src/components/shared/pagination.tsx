import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Previous/next links with page numbers around the current page. `href` builds the URL for a page, keeping the filters. */
export function Pagination({ page, pages, total, href }: { page: number; pages: number; total: number; href: (page: number) => string }) {
  if (pages <= 1) return <p className="mt-4 text-sm text-muted-foreground">Всего: {total}</p>;
  const shown = Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 1);

  return (
    <nav aria-label="Страницы" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">
        Страница {page} из {pages} · всего {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" className="h-10" disabled={page <= 1} nativeButton={false} render={<Link href={href(page - 1)} aria-label="Предыдущая страница" />}>
          <ChevronLeft />
        </Button>
        {shown.map((p, i) => (
          <span key={p} className="flex items-center gap-1">
            {i > 0 && p - shown[i - 1] > 1 && <span className="px-1 text-muted-foreground">…</span>}
            <Button variant={p === page ? "default" : "outline"} className="h-10 min-w-10" nativeButton={false} render={<Link href={href(p)} aria-current={p === page ? "page" : undefined} />}>
              {p}
            </Button>
          </span>
        ))}
        <Button variant="outline" className="h-10" disabled={page >= pages} nativeButton={false} render={<Link href={href(page + 1)} aria-label="Следующая страница" />}>
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
