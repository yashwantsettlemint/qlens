"use client";

import { Button } from "@/components/ui/Button";
import { TextInput, Select } from "@/components/ui/Field";

export interface LineItem {
  description: string;
  note: string;
  quantity: string;
  unit: string;
  hsnSac: string;
  gstRate: string;
  unitPrice: string;
}

const UNITS = ["Units", "Days", "Hours", "Pieces", "Kg"];

export const emptyLineItem = (): LineItem => ({
  description: "",
  note: "",
  quantity: "1",
  unit: "Units",
  hsnSac: "",
  gstRate: "18",
  unitPrice: "",
});

export function LineItemsEditor({
  items,
  onChange,
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
}) {
  function set(i: number, patch: Partial<LineItem>) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  const subtotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);

  return (
    <div>
      <div className="space-y-4">
        {items.map((it, i) => (
          <div key={i} className="rounded-lg border border-line p-3">
            <div className="grid grid-cols-[1fr_32px] gap-2">
              <TextInput
                value={it.description}
                onChange={(e) => set(i, { description: e.target.value })}
                placeholder="Service / category, e.g. Design and Development Services"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={items.length === 1}
                className="text-ink-faint hover:text-bad-fg disabled:opacity-30"
                aria-label="Remove line item"
              >
                ×
              </button>
            </div>
            <TextInput
              className="mt-1.5"
              value={it.note}
              onChange={(e) => set(i, { note: e.target.value })}
              placeholder="Who/what it's for, e.g. Jane Doe - Kubernetes Engineer (optional)"
            />
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <div className="mb-1 text-2xs text-ink-muted">HSN/SAC</div>
                <TextInput value={it.hsnSac} onChange={(e) => set(i, { hsnSac: e.target.value })} placeholder="998314" />
              </div>
              <div>
                <div className="mb-1 text-2xs text-ink-muted">GST %</div>
                <TextInput
                  type="number"
                  min="0"
                  value={it.gstRate}
                  onChange={(e) => set(i, { gstRate: e.target.value })}
                />
              </div>
              <div>
                <div className="mb-1 text-2xs text-ink-muted">Qty</div>
                <TextInput
                  type="number"
                  min="0"
                  value={it.quantity}
                  onChange={(e) => set(i, { quantity: e.target.value })}
                />
              </div>
              <div>
                <div className="mb-1 text-2xs text-ink-muted">Unit</div>
                <Select value={it.unit} onChange={(e) => set(i, { unit: e.target.value })}>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <div className="mb-1 text-2xs text-ink-muted">Rate</div>
                <TextInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={it.unitPrice}
                  onChange={(e) => set(i, { unitPrice: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <div className="mb-1 text-2xs text-ink-muted">Amount</div>
                <div className="flex h-9 items-center justify-end text-sm text-ink">
                  {((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)).toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="default" className="mt-3" onClick={() => onChange([...items, emptyLineItem()])}>
        + Add item
      </Button>
      <div className="mt-3 flex justify-end text-sm">
        <span className="text-ink-muted">Subtotal:&nbsp;</span>
        <span className="font-semibold text-ink">{subtotal.toFixed(2)}</span>
      </div>
    </div>
  );
}
