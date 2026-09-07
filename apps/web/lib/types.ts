import type {
  InvoiceRowFieldsFragment,
  InvoiceDetailQuery,
  VendorsQuery,
} from "@/graphql/generated/graphql";

/** The invoice shape every table row renders. */
export type InvoiceRow = InvoiceRowFieldsFragment;

/** Full invoice as returned by the detail query (non-null). */
export type InvoiceDetail = NonNullable<InvoiceDetailQuery["invoice"]>;

export type VendorStatsRow = VendorsQuery["vendors"][number];
