// /services/[id] — the canonical service page. The catalog ID carries
// colons and arrives URL-encoded. An unknown ID is a real 404 with a
// designed page, not a blank error. Params access is isolated in the
// Suspense-wrapped async content component per cacheComponents rules.

import { Suspense } from "react";
import { notFound } from "next/navigation";

import { ServiceDetail } from "@/components/ServiceDetail";
import { serviceById, serviceView, versions } from "@/lib/web/server-context";

export default function ServicePage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
      <ServiceContent params={props.params} />
    </Suspense>
  );
}

async function ServiceContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = serviceById(decodeId(id));
  if (record === undefined) {
    notFound();
  }
  const view = serviceView(record);
  return (
    <div className="mx-auto max-w-3xl py-6">
      <ServiceDetail view={view} versions={versions} />
    </div>
  );
}

function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
