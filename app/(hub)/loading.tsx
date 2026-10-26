export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading workspace"
      className="animate-pulse space-y-6"
    >
      <div className="h-12 w-64 rounded bg-slate-200" />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="panel h-32 bg-slate-100" />
        ))}
      </div>
      <div className="panel h-80 bg-slate-100" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
