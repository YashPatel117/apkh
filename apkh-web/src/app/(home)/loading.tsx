export default function HomeLoading() {
  return (
    <div className="flex h-dvh overflow-hidden" aria-busy="true" aria-label="Loading your workspace">
      <aside className="hidden w-64 shrink-0 flex-col gap-3 border-r border-line bg-surface/80 p-4 lg:flex">
        <div className="flex items-center gap-2.5 pb-3">
          <div className="size-9 animate-pulse rounded-xl bg-surface-2" />
          <div className="h-4 w-28 animate-pulse rounded-full bg-surface-2" />
        </div>
        <div className="h-10 animate-pulse rounded-xl bg-surface-2" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-xl bg-surface-2/70" />
        ))}
      </aside>
      <div className="flex flex-1 flex-col">
        <div className="flex h-16 items-center gap-3 border-b border-line bg-surface/75 px-5">
          <div className="h-11 max-w-3xl flex-1 animate-pulse rounded-xl bg-surface-2" />
          <div className="h-11 w-24 animate-pulse rounded-xl bg-surface-2" />
        </div>
        <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
          <div className="h-8 w-48 animate-pulse rounded-xl bg-surface-2" />
          <div className="mt-2 h-4 w-72 animate-pulse rounded-full bg-surface-2/70" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[44, 56, 40, 52, 48, 36].map((h, i) => (
              <div key={i} className="animate-pulse rounded-3xl border border-line bg-surface" style={{ height: `${h * 4}px` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
