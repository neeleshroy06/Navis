"use client";

import { MapPin, Search } from "lucide-react";
import { useState } from "react";
import { googleMapsPharmaciesNearZip } from "@/lib/maps/externalMapLinks";

export function PharmacyFinderPanel() {
  const [zip, setZip] = useState("");
  const [error, setError] = useState<string | null>(null);

  const openMaps = () => {
    const q = zip.trim();
    if (!/^\d{5}$/.test(q)) {
      setError("Enter a 5-digit U.S. ZIP code.");
      return;
    }
    setError(null);
    window.location.assign(googleMapsPharmaciesNearZip(q));
  };

  return (
    <section className="rounded-2xl border border-[var(--recast-border)]/60 bg-[var(--recast-surface-elevated)]/80 p-4 ring-1 ring-[var(--recast-border)]/25">
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--recast-accent)]" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--recast-text)]">
            Find nearby pharmacies
          </h2>

          <form
            className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch"
            onSubmit={(e) => {
              e.preventDefault();
              openMaps();
            }}
          >
            <input
              type="text"
              inputMode="numeric"
              value={zip}
              onChange={(e) => {
                setZip(e.target.value.replace(/\D/g, "").slice(0, 5));
                setError(null);
              }}
              placeholder="ZIP code (e.g. 92507)"
              autoComplete="postal-code"
              className="min-h-10 min-w-0 flex-1 rounded-xl border border-[var(--recast-border)]/70 bg-[var(--recast-surface)]/90 px-3 py-2 text-sm text-[var(--recast-text)] outline-none ring-0 placeholder:text-[var(--recast-text-muted)] focus:border-[var(--recast-accent)] focus:ring-2 focus:ring-[var(--recast-accent-soft)]"
            />
            <button
              type="submit"
              className="inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[var(--recast-accent)] px-4 py-2 text-center text-sm font-medium text-white transition hover:bg-[var(--recast-accent-hover)]"
            >
              <Search className="h-4 w-4" strokeWidth={2} />
              Find pharmacies
            </button>
          </form>

          {error ? (
            <p className="mt-3 text-xs leading-relaxed text-red-600 dark:text-red-400">{error}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
