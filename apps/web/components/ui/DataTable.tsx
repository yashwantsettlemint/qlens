"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { IconChevron, IconSort } from "./icons";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  sortable?: boolean;
  /** Value used for client-side sorting (uncontrolled mode). */
  sortValue?: (row: T) => string | number;
  cell: (row: T) => React.ReactNode;
  width?: string;
}

export interface SortState {
  field: string;
  dir: "ASC" | "DESC";
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowId: (row: T) => string;
  rowHref?: (row: T) => string;
  /** Controlled sort — provide both to drive sorting from the parent/query. */
  sort?: SortState;
  onSortChange?: (field: string) => void;
  /** Uncontrolled default sort (client-side). */
  defaultSort?: SortState;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectedChange?: (ids: Set<string>) => void;
  empty?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowId,
  rowHref,
  sort,
  onSortChange,
  defaultSort,
  selectable,
  selectedIds,
  onSelectedChange,
  empty,
  className,
}: DataTableProps<T>) {
  const router = useRouter();
  const controlled = Boolean(onSortChange);
  const [localSort, setLocalSort] = useState<SortState | undefined>(defaultSort);
  const active = controlled ? sort : localSort;

  const sortedRows = useMemo(() => {
    if (controlled || !localSort) return rows;
    const col = columns.find((c) => c.key === localSort.field);
    if (!col?.sortValue) return rows;
    const sign = localSort.dir === "DESC" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      return va < vb ? -sign : va > vb ? sign : 0;
    });
  }, [rows, columns, localSort, controlled]);

  function toggleSort(field: string) {
    if (controlled) return onSortChange!(field);
    setLocalSort((s) =>
      s?.field === field
        ? { field, dir: s.dir === "ASC" ? "DESC" : "ASC" }
        : { field, dir: "ASC" },
    );
  }

  const allSelected =
    selectable && sortedRows.length > 0 && sortedRows.every((r) => selectedIds?.has(rowId(r)));

  function toggleAll() {
    if (!onSelectedChange) return;
    onSelectedChange(allSelected ? new Set() : new Set(sortedRows.map(rowId)));
  }
  function toggleOne(id: string) {
    if (!onSelectedChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  }

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border border-line bg-surface shadow-card",
        className,
      )}
    >
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-line text-left text-xs text-ink-muted">
            {selectable && (
              <th className="w-9 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={Boolean(allSelected)}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map((c) => {
              const isActive = active?.field === c.key;
              return (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={cn(
                    "px-4 py-3 font-medium",
                    c.align === "right" && "text-right",
                  )}
                >
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-ink",
                        c.align === "right" && "flex-row-reverse",
                        isActive && "text-ink",
                      )}
                    >
                      {c.header}
                      {isActive ? (
                        <IconChevron
                          width={13}
                          height={13}
                          className={cn(active?.dir === "ASC" && "rotate-180")}
                        />
                      ) : (
                        <IconSort width={12} height={12} className="opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="px-4 py-12 text-center text-sm text-ink-muted"
              >
                {empty ?? "Nothing to show."}
              </td>
            </tr>
          )}
          {sortedRows.map((row) => {
            const id = rowId(row);
            const href = rowHref?.(row);
            return (
              <tr
                key={id}
                className={cn(
                  "border-b border-line last:border-0 hover:bg-ground",
                  href && "cursor-pointer",
                )}
                onClick={href ? () => router.push(href) : undefined}
              >
                {selectable && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${id}`}
                      checked={Boolean(selectedIds?.has(id))}
                      onChange={() => toggleOne(id)}
                    />
                  </td>
                )}
                {columns.map((c, ci) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-4 py-3 align-middle",
                      c.align === "right" && "text-right",
                    )}
                  >
                    {href && ci === 0 ? (
                      <Link
                        href={href}
                        className="text-accent hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.cell(row)}
                      </Link>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
