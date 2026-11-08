export default function AdminLoading() {
  return (
    <div role="status" aria-label="Загрузка" className="animate-pulse space-y-6">
      <div className="h-8 w-56 rounded-lg bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-72 rounded-xl bg-muted" />
    </div>
  );
}
