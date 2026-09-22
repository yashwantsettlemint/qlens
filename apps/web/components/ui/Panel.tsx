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
        "rounded-xl border bg-surface shadow-card",
        accent ? "border-genai/30" : "border-line",
        className,
      )}
    >
      {title != null && (
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
