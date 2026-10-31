"use client";
import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "./ui";

export function PrintButton({ label = "Print", auto }: { label?: string; auto?: boolean }) {
  useEffect(() => {
    if (auto) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [auto]);
  return (
    <Button onClick={() => window.print()} className="no-print">
      <Printer className="size-4" aria-hidden /> {label}
    </Button>
  );
}
