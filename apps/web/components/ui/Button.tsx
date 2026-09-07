import { cn } from "@/lib/cn";

type Variant = "primary" | "default" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink border-accent hover:bg-[#0a558f]",
  default: "bg-surface text-ink border-line hover:bg-ground",
  ghost: "bg-transparent text-ink-muted border-transparent hover:bg-line/50",
  danger: "bg-surface text-bad-fg border-bad-fg/40 hover:bg-bad-bg",
};

export function Button({
  variant = "default",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        className,
      )}
    />
  );
}
