import type {
  InvoiceRowFieldsFragment,
  InvoiceDetailQuery,
  VendorsQuery,
  CustomersQuery,
} from "@/graphql/generated/graphql";

/** The invoice shape every table row renders (payable or receivable). */
export type InvoiceRow = InvoiceRowFieldsFragment;

/** Full invoice as returned by the detail query (non-null). */
export type InvoiceDetail = NonNullable<InvoiceDetailQuery["invoice"]>;

export type VendorStatsRow = VendorsQuery["vendors"][number];
export type CustomerStatsRow = CustomersQuery["customers"][number];
