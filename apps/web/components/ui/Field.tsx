import { cn } from "@/lib/cn";

const controlBase =
  "h-8 rounded border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50";

export function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs text-ink-muted">{children}</span>;
}

export function TextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(controlBase, "w-full", className)} />;
}

export function DateInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="date" {...props} className={cn(controlBase, props.className)} />;
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(controlBase, "pr-6", className)}>
      {children}
    </select>
  );
}

/** Labelled field wrapper for forms and filter bars. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <Label>{label}</Label>
      {children}
    </label>
  );
}
