"use client";
import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "./ui";

/** Uploads an image to the tenant's upload endpoint and stores the URL in a hidden input. */
export function ImageUpload({
  tenantSlug,
  name,
  defaultValue,
  label = "Photo",
}: {
  tenantSlug: string;
  name: string;
  defaultValue?: string | null;
  label?: string;
}) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > 2 * 1024 * 1024) {
      setError("Images must be 2 MB or smaller.");
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`/api/app/${tenantSlug}/uploads`, { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) setError(body?.error?.message ?? "Upload failed. Try again.");
      else setUrl(body.url);
    } catch {
      setError("Upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-charcoal-800 text-sm font-medium">{label}</span>
      <input type="hidden" name={name} value={url} />
      <div className="flex items-center gap-3">
        <div className="border-ivory-300 bg-ivory-100 grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="size-full object-cover" />
          ) : (
            <ImagePlus className="text-charcoal-300 size-6" aria-hidden />
          )}
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            id={`${name}-file`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : url ? "Replace photo" : "Upload photo"}
          </Button>
          {url ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setUrl("")}>
              <X className="size-3.5" aria-hidden /> Remove
            </Button>
          ) : null}
          <span className="text-charcoal-500 text-xs">JPEG, PNG or WebP, up to 2 MB. Use your own photos.</span>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-danger-700 text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
