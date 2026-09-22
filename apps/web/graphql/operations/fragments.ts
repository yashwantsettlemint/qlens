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
    direction
    collectionStatus
    vendor {
      id
      name
    }
    customer {
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
