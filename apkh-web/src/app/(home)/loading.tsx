export default function HomeLoading() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.18),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.14),_transparent_26%),linear-gradient(180deg,_#f8fbff_0%,_#f8fafc_48%,_#eef4ff_100%)] p-4 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-10 w-28 animate-pulse rounded-xl bg-white/80 shadow-sm" />
          <div className="h-12 w-40 animate-pulse rounded-2xl bg-white/80 shadow-sm" />
        </div>

        <div className="overflow-hidden rounded-[24px] border border-sky-100/90 bg-white/85 p-4 shadow-[0_24px_80px_-48px_rgba(14,116,144,0.55)] backdrop-blur">
          <div className="space-y-3">
            <div className="h-5 w-40 animate-pulse rounded-full bg-sky-100" />
            <div className="h-8 w-72 animate-pulse rounded-xl bg-slate-200/80" />
            <div className="h-12 w-full animate-pulse rounded-[18px] bg-white shadow-sm" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="h-44 animate-pulse rounded-[24px] bg-white/85 shadow-sm" />
          <div className="h-52 animate-pulse rounded-[24px] bg-white/85 shadow-sm" />
          <div className="h-40 animate-pulse rounded-[24px] bg-white/85 shadow-sm" />
        </div>
      </div>
    </div>
  );
}
