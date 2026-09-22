import { QlensMark } from "@/components/brand/QlensMark";

type FlaggedRow = {
  invoiceNumber: string;
  vendor: string;
  amount: string;
  reason: string;
  dot: "bad" | "warn" | "dup";
};

const dotColor: Record<FlaggedRow["dot"], string> = {
  bad: "bg-[#ff6b5e]",
  warn: "bg-[#f0b13d]",
  dup: "bg-[#b98cf2]",
};

// Representative, not live data — grounds the page in what Qlens actually
// surfaces (RiskDot / DuplicateBadge) instead of an abstract illustration.
const FLAGGED: FlaggedRow[] = [
  { invoiceNumber: "INV-2381", vendor: "Ashwin Freight Movers", amount: "₹2,05,900", reason: "Possible duplicate", dot: "dup" },
  { invoiceNumber: "INV-2379", vendor: "Meridian Logistics", amount: "₹84,200", reason: "Predicted 6d late", dot: "bad" },
  { invoiceNumber: "INV-2402", vendor: "Kavya Textiles", amount: "₹1,12,450", reason: "Predicted 2d late", dot: "warn" },
];

/** Shared chrome for /login and /register: a left-aligned form column and a
 * right glimpse panel built from the product's own vocabulary (invoice
 * number, vendor, risk dot) rather than decorative art. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen font-plex">
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-[46%] lg:px-16 xl:px-20">
        <div className="mx-auto w-full max-w-[400px]">
          <div className="mb-9 flex items-center gap-2.5">
            <QlensMark size={26} />
            <span className="font-display text-lg font-extrabold tracking-tight text-ink">Qlens</span>
          </div>
          {children}
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-panel-navy lg:flex lg:w-[54%] lg:flex-col lg:justify-center lg:px-16 xl:px-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(var(--panel-navy-line) 1px, transparent 1px), linear-gradient(90deg, var(--panel-navy-line) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative max-w-[440px]">
          <p className="font-display text-2xl font-semibold text-white">Today&apos;s flagged invoices</p>
          <p className="mt-1.5 text-[15px] text-panel-navy-ink">
            Scored the moment they land — duplicates and late-payment risk, before they reach approval.
          </p>

          <div className="mt-7 space-y-2.5">
            {FLAGGED.map((row) => (
              <div
                key={row.invoiceNumber}
                className="rounded-lg border border-panel-navy-line bg-white/[0.04] px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="tabular text-sm font-medium text-white">{row.invoiceNumber}</span>
                  <span className="tabular text-sm text-panel-navy-ink">{row.amount}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] text-panel-navy-ink">{row.vendor}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-panel-navy-ink">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor[row.dot]}`} />
                    {row.reason}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-5 text-[13px] text-panel-navy-ink/70">+ 11 more waiting for review</p>
        </div>
      </div>
    </div>
  );
}
