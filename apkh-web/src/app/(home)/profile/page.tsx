"use client";

import { useAppSelector } from "@/store/hook";
import Button from "@mui/material/Button";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import BadgeRoundedIcon from "@mui/icons-material/BadgeRounded";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import StickyNote2OutlinedIcon from "@mui/icons-material/StickyNote2Outlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import TokenOutlinedIcon from "@mui/icons-material/TokenOutlined";
import { useRouter } from "next/navigation";
import LlmSettingsCard from "./LlmSettingsCard";

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getPlanTone(type: string) {
  const normalized = type.toLowerCase();

  if (normalized.includes("pro") || normalized.includes("premium")) {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  if (normalized.includes("admin")) {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  return "bg-sky-50 text-sky-700 ring-sky-200";
}

export default function ProfilePage() {
  const { user } = useAppSelector((state) => state.auth);
  const { notes } = useAppSelector((state) => state.note);
  const router = useRouter();

  if (!user) {
    return (
      <main className="p-4 sm:px-6 sm:pb-8">
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white/85 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
            Profile
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
            Loading your profile
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Your account details will appear here in a moment.
          </p>
        </div>
      </main>
    );
  }

  const planTone = getPlanTone(user.type);
  const notesCount = notes.length;
  const firstName = user.name.split(" ")[0] || user.name;

  return (
    <main className="p-4 sm:px-6 sm:pb-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button
          variant="outlined"
          className="gap-2! rounded-full! border-slate-200! bg-white! px-4! py-2! text-slate-700!"
          onClick={() => router.back()}
        >
          <ArrowBackIcon fontSize="small" />
          <span className="text-sm font-medium">Back</span>
        </Button>
        <Button
          variant="text"
          className="rounded-full! px-4! py-2! text-sky-700!"
          onClick={() => router.push("/notes")}
        >
          Go To Notes
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)] ">
        <section className="rounded-[28px] border border-white/80 bg-white/88 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.9)]">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-[linear-gradient(135deg,_#0ea5e9,_#2563eb)] text-2xl font-bold tracking-wide text-white shadow-lg">
                {getInitials(user.name)}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                  Personal Profile
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                  {user.name}
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                  Welcome back, {firstName}. This is your account snapshot,
                  workspace context, and current access level in one place.
                </p>
              </div>
            </div>

            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ring-1 ${planTone}`}
            >
              {user.type}
            </span>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-[22px] border border-slate-200 bg-slate-50/90 p-4">
              <div className="flex items-center gap-2 text-sky-700">
                <BadgeRoundedIcon sx={{ fontSize: 18 }} />
                <span className="text-xs font-semibold uppercase tracking-[0.2em]">
                  Full Name
                </span>
              </div>
              <p className="mt-3 text-base font-semibold text-slate-900">
                {user.name}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Displayed across your workspace.
              </p>
            </div>

            <div className="rounded-[22px] border border-slate-200 bg-slate-50/90 p-4">
              <div className="flex items-center gap-2 text-sky-700">
                <EmailRoundedIcon sx={{ fontSize: 18 }} />
                <span className="text-xs font-semibold uppercase tracking-[0.2em]">
                  Email
                </span>
              </div>
              <p className="mt-3 break-all text-base font-semibold text-slate-900">
                {user.email}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Used for authentication and recovery.
              </p>
            </div>

            <div className="rounded-[22px] border border-slate-200 bg-slate-50/90 p-4">
              <div className="flex items-center gap-2 text-sky-700">
                <ShieldOutlinedIcon sx={{ fontSize: 18 }} />
                <span className="text-xs font-semibold uppercase tracking-[0.2em]">
                  Access Level
                </span>
              </div>
              <p className="mt-3 text-base font-semibold uppercase text-slate-900">
                {user.type}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Controls the account capabilities available to you.
              </p>
            </div>

            <div className="rounded-[22px] border border-slate-200 bg-slate-50/90 p-4">
              <div className="flex items-center gap-2 text-violet-700">
                <TokenOutlinedIcon sx={{ fontSize: 18 }} />
                <span className="text-xs font-semibold uppercase tracking-[0.2em]">
                  AI Tokens Used
                </span>
              </div>
              <p className="mt-3 text-base font-semibold text-slate-900">
                {(user.totalTokensUsed ?? 0).toLocaleString()}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Total tokens consumed across all AI search queries.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sky-700">
              <StickyNote2OutlinedIcon sx={{ fontSize: 18 }} />
              <span className="text-xs font-semibold uppercase tracking-[0.22em]">
                Workspace Snapshot
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-[22px] bg-sky-50 p-4 ring-1 ring-sky-100">
                <p className="text-sm font-medium text-sky-700">Saved Notes</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                  {notesCount}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Knowledge entries currently available in your workspace.
                </p>
              </div>

              <div className="rounded-[22px] bg-indigo-50 p-4 ring-1 ring-indigo-100">
                <div className="flex items-center gap-2 text-indigo-700">
                  <AutoAwesomeOutlinedIcon sx={{ fontSize: 18 }} />
                  <p className="text-sm font-medium">AI Search Status</p>
                </div>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  Ready for grounded answers
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Your notes can already be used as source material for AI
                  search and references.
                </p>
              </div>
            </div>
          </div>

          <LlmSettingsCard user={user} />

          <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
              Quick Actions
            </p>
            <div className="mt-4 flex flex-col gap-3">
              <Button
                variant="contained"
                className="justify-start! rounded-[18px]! px-4! py-3! text-left! normal-case!"
                onClick={() => router.push("/notes")}
              >
                Open Notes Workspace
              </Button>
              <Button
                variant="outlined"
                className="justify-start! rounded-[18px]! px-4! py-3! text-left! normal-case!"
                onClick={() => router.back()}
              >
                Return To Previous Page
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
