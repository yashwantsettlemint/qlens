import { graphql } from "../generated";

export const DashboardStatsQuery = graphql(`
  query DashboardStats($vendorId: ID) {
    dashboardStats(vendorId: $vendorId) {
      pendingCount
      pendingAmount
      overdueCount
      overdueAmount
      vendorExposureTotal
      approvedUnpaidCount
      approvedUnpaidAmount
      paidLast30Count
      paidLast30Amount
      rejectedCount
      avgDaysToPay
    }
  }
`);

export const VendorExposureQuery = graphql(`
  query VendorExposure($vendorId: ID) {
    vendorExposure(vendorId: $vendorId) {
      vendorId
      vendorName
      outstanding
    }
  }
`);

export const InvoicesQuery = graphql(`
  query Invoices($filter: InvoiceFilter, $sort: InvoiceSort, $page: Int, $pageSize: Int) {
    invoices(filter: $filter, sort: $sort, page: $page, pageSize: $pageSize) {
      total
      page
      pageSize
      rows {
        ...InvoiceRowFields
      }
    }
  }
`);

export const InvoiceDetailQuery = graphql(`
  query InvoiceDetail($id: ID!) {
    invoice(id: $id) {
      ...InvoiceRowFields
      vendor {
        id
        name
        taxId
        paymentTermsDays
      }
      purchaseOrder {
        id
        poNumber
        amount
        status
        department
      }
      duplicateFlag {
        matchedInvoiceId
        confidenceScore
        reviewedStatus
        matchedInvoice {
          id
          invoiceNumber
          amount
          taxAmount
          invoiceDate
          vendor {
            name
          }
        }
      }
      delayPrediction {
        delayProbability
        predictedDelayDays
        modelVersion
      }
      approvalEvents {
        id
        actor
        action
        note
        at
      }
      payments {
        id
        paidAt
        amountPaid
      }
    }
  }
`);

export const VendorsQuery = graphql(`
  query Vendors {
    vendors {
      vendor {
        id
        name
        taxId
        paymentTermsDays
      }
      totalInvoices
      totalExposure
      avgDelayDays
      onTimePct
    }
  }
`);

export const VendorDetailQuery = graphql(`
  query VendorDetail($id: ID!) {
    vendor(id: $id) {
      vendor {
        id
        name
        taxId
        paymentTermsDays
      }
      totalInvoices
      totalExposure
      avgDelayDays
      onTimePct
    }
  }
`);

export const AskQuery = graphql(`
  query Ask($prompt: String!) {
    ask(prompt: $prompt) {
      text
      invoices {
        ...InvoiceRowFields
      }
    }
  }
`);
