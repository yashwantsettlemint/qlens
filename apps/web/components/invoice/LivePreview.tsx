"use client";

import { PDFViewer } from "@react-pdf/renderer";
import { InvoiceDocument, type InvoiceDocumentData } from "@/lib/pdf/InvoiceDocument";

/** Renders InvoiceDocument live in the browser (no server round-trip) — used
 * by the create-invoice page so the PDF updates as the form is filled in.
 * Must only be loaded client-side (next/dynamic ssr:false), since
 * @react-pdf/renderer's PDFViewer needs the DOM. */
export function LivePreview({ data }: { data: InvoiceDocumentData }) {
  return (
    <PDFViewer style={{ width: "100%", height: "100%", border: "none" }} showToolbar={false}>
      <InvoiceDocument {...data} />
    </PDFViewer>
  );
}
