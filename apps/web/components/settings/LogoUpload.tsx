"use client";

import { useRef, useState } from "react";
import { useMutation } from "@apollo/client";
import { SaveCompanyLogoMutation } from "@/graphql/operations/mutations";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";

const MAX_BYTES = 1_000_000; // 1MB — a data: URL logo is embedded in every generated PDF

/** Upload-once, saved-as-default company logo — printed in the header of
 * every generated invoice (see lib/pdf/InvoiceDocument.tsx). */
export function LogoUpload({ savedDataUrl }: { savedDataUrl: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(savedDataUrl);
  const [save, { loading }] = useMutation(SaveCompanyLogoMutation);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function pickFile(file: File | undefined) {
    setOk(null);
    setErr(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Pick an image file (PNG, JPG, SVG).");
    if (file.size > MAX_BYTES) return setErr("Image is too large — keep it under 1MB.");
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!preview) return;
    setErr(null);
    setOk(null);
    try {
      await save({ variables: { dataUrl: preview } });
      setOk("Logo saved — it'll appear on every invoice you generate from now on.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the logo");
    }
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center rounded border border-line bg-white">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Company logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-2xs text-ink-faint">No logo</span>
          )}
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <Button type="button" variant="default" onClick={() => fileRef.current?.click()}>
            Choose image
          </Button>
          <p className="mt-1.5 text-2xs text-ink-muted">PNG, JPG or SVG, under 1MB.</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          variant="primary"
          onClick={submit}
          disabled={loading || !preview || preview === savedDataUrl}
        >
          {loading ? "Saving…" : "Save logo"}
        </Button>
      </div>
      {err && <Callout tone="bad" className="mt-3 text-xs">{err}</Callout>}
      {ok && <Callout tone="ok" className="mt-3 text-xs">{ok}</Callout>}
    </div>
  );
}
