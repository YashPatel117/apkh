"use client";

import { Cpu, FolderOpen, TriangleAlert } from "lucide-react";
import { activeAi, IUser, searchesByMeaning } from "@/models/user";
import { useT } from "@/i18n";

export default function SearchStatusCard({ user, totalNotes }: { user: IUser; totalNotes: number }) {
  const t = useT();
  const ai = activeAi(user);

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="font-semibold text-fg">{t("profile.searchStatus")}</h2>
      {ai && searchesByMeaning(ai) ? (
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Cpu className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{t("profile.ready")}</p>
            <p className="mt-0.5 truncate opacity-90">{t("profile.using", { name: ai.name, model: ai.model })}</p>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{ai ? t("profile.keywordOnly") : t("card.aiOff")}</p>
            <p className="mt-0.5 opacity-90">
              {ai ? t("profile.keywordOnlyText", { model: ai.model }) : t("profile.aiOffText")}
            </p>
          </div>
        </div>
      )}
      <div className="mt-4 flex items-center gap-2 text-xs text-fg-subtle">
        <FolderOpen className="size-3.5" /> {t("profile.sourceNotes", { count: totalNotes })}
      </div>
    </section>
  );
}
