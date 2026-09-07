import { graphql } from "../generated";

export const ApproveInvoicesMutation = graphql(`
  mutation ApproveInvoices($ids: [ID!]!) {
    approveInvoices(ids: $ids) {
      id
      approvalStatus
    }
  }
`);

export const SetApprovalMutation = graphql(`
  mutation SetApproval($id: ID!, $status: ApprovalStatus!, $note: String) {
    setApproval(id: $id, status: $status, note: $note) {
      id
      approvalStatus
    }
  }
`);

export const ReviewDuplicateMutation = graphql(`
  mutation ReviewDuplicate($invoiceId: ID!, $status: String!) {
    reviewDuplicate(invoiceId: $invoiceId, status: $status) {
      id
      duplicateFlag {
        reviewedStatus
      }
    }
  }
`);

export const RecordPaymentMutation = graphql(`
  mutation RecordPayment($invoiceId: ID!, $paidAt: String!, $amountPaid: Float!) {
    recordPayment(invoiceId: $invoiceId, paidAt: $paidAt, amountPaid: $amountPaid) {
      id
      paidAt
      amountPaid
    }
  }
`);

export const CreateInvoiceMutation = graphql(`
  mutation CreateInvoice($input: InvoiceInput!) {
    createInvoice(input: $input) {
      id
      invoiceNumber
    }
  }
`);

export const ImportInvoicesMutation = graphql(`
  mutation ImportInvoices($rows: [InvoiceInput!]!) {
    importInvoices(rows: $rows) {
      created
      failed
      errors {
        row
        message
      }
    }
  }
`);
