"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@apollo/client";
import { SaveCompanySignatureMutation } from "@/graphql/operations/mutations";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";

/** Draw-once, saved-as-default signature — stamped on every generated
 * invoice from then on (see lib/pdf/InvoiceDocument.tsx). */
export function SignaturePad({ savedDataUrl }: { savedDataUrl: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const hasStroke = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [save, { loading }] = useMutation(SaveCompanySignatureMutation);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1b2430";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (savedDataUrl) {
      const img = new window.Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = savedDataUrl;
    }
  }, [savedDataUrl]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasStroke.current = true;
    setDirty(true);
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    hasStroke.current = false;
    setDirty(true);
    setOk(null);
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Pick an image file (PNG or JPG).");
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    setErr(null);
    setOk(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        hasStroke.current = true;
        setDirty(true);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setErr(null);
    setOk(null);
    try {
      await save({ variables: { dataUrl: canvas.toDataURL("image/png") } });
      setOk("Signature saved — it'll be stamped on every invoice you generate from now on.");
      setDirty(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the signature");
    }
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={360}
        height={140}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="touch-none rounded border border-line bg-white"
      />
      <p className="mt-1.5 text-2xs text-ink-muted">Draw with your mouse or finger, or upload an image.</p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pickFile(e.target.files?.[0])}
      />
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="default" onClick={() => fileRef.current?.click()}>
          Upload image
        </Button>
        <Button type="button" variant="default" onClick={clear}>
          Clear
        </Button>
        <Button type="button" variant="primary" onClick={submit} disabled={loading || !dirty}>
          {loading ? "Saving…" : "Save signature"}
        </Button>
      </div>
      {err && <Callout tone="bad" className="mt-3 text-xs">{err}</Callout>}
      {ok && <Callout tone="ok" className="mt-3 text-xs">{ok}</Callout>}
    </div>
  );
}
