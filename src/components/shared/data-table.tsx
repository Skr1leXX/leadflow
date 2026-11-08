import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "./empty-state";

export interface Column<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

export function DataTable<T extends { id: string }>({ columns, rows }: { columns: Column<T>[]; rows: T[] }) {
  return (
    <Card className="overflow-hidden p-0">
      {rows.length === 0 ? (
        <EmptyState title="Ничего не найдено" description="Измените фильтры или добавьте первую запись." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {columns.map((c) => (
                <TableHead key={c.header} className={c.className}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                {columns.map((c) => (
                  <TableCell key={c.header} className={c.className}>
                    {c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
