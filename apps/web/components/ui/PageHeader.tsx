export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-medium text-ink">{title}</h1>
        {meta != null && <div className="mt-1 text-sm text-ink-muted">{meta}</div>}
      </div>
      {actions != null && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
