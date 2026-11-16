"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

type FeedBuildProgressProps = {
  profileName?: string;
  tags?: string[];
  channels?: string[];
  variant?: "full" | "compact";
  loadingLabel?: string;
};

export function FeedBuildProgress({ profileName, variant = "full" }: FeedBuildProgressProps) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setSlow(true), 20000);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <section className={`feed-build-status ${variant}`} role="status" aria-live="polite">
      <LoaderCircle size={20} className="spinner" aria-hidden="true" />
      <div>
        <p>Finding videos{profileName ? ` for ${profileName}` : " for you"}…</p>
        {slow && <p className="feed-build-detail">This is taking a little longer. You can keep browsing while Gretel finds recommendations.</p>}
      </div>
    </section>
  );
}
