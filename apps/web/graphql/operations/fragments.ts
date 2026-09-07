import { graphql } from "../generated";

/** The columns every invoice table needs. */
export const InvoiceRowFields = graphql(`
  fragment InvoiceRowFields on Invoice {
    id
    invoiceNumber
    invoiceDate
    dueDate
    amount
    taxAmount
    department
    approvalStatus
    paymentStatus
    source
    daysOverdue
    vendor {
      id
      name
    }
    duplicateFlag {
      reviewedStatus
      confidenceScore
    }
    delayPrediction {
      delayProbability
      predictedDelayDays
    }
  }
`);
