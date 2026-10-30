export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col items-center gap-4 px-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          NYC Service Estimation Assistant
        </h1>
        <p className="text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Turns a goal into cost estimates, ordered steps, and required
          documents for New York City government services. The service catalog
          and resolver land in upcoming milestones; API health is available at{" "}
          <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
            /api/health
          </code>
          .
        </p>
      </main>
    </div>
  );
}
