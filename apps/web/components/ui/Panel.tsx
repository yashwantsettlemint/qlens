import { cn } from "@/lib/cn";

export function Panel({
  title,
  actions,
  children,
  className,
  accent = false,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <section
      className={cn(
        "border bg-surface",
        accent ? "border-genai/30" : "border-line",
        className,
      )}
    >
      {title != null && (
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
