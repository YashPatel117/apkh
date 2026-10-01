"use client";

import { useState } from "react";
import { Check, Crown, KeyRound, ListOrdered, Sparkles } from "lucide-react";
import { BUILTIN_AI_ENABLED, BUILTIN_AI_LABEL, IPlan, IUser } from "@/models/user";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import UpgradeModal from "./UpgradeModal";

function Feature({ Icon, children }: { Icon: typeof Check; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-accent" />
      <span>{children}</span>
    </li>
  );
}

function PlanColumn({
  plan,
  current,
  disabled,
  onUpgrade,
}: {
  plan: IPlan;
  current: boolean;
  disabled: boolean;
  onUpgrade?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border p-4",
        current ? "border-indigo-200 bg-accent-soft dark:border-indigo-400/30" : "border-line bg-surface",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold text-fg">
          {plan.id === "pro" && <Crown className="size-4 text-amber-500" />}
          {plan.label}
        </p>
        {current && (
          <span className="rounded-md bg-indigo-600 px-1.5 py-0.5 text-[0.62rem] font-bold tracking-wider text-white uppercase dark:bg-indigo-500">
            Your plan
          </span>
        )}
      </div>
      <ul className="mt-3 flex-1 space-y-2 text-xs text-fg-muted">
        <Feature Icon={Sparkles}>
          {BUILTIN_AI_LABEL}: <span className="font-semibold text-fg tabular-nums">{plan.sessionTokens.toLocaleString()}</span> tokens per{" "}
          {plan.sessionHours}-hour session
        </Feature>
        <Feature Icon={ListOrdered}>{plan.priority ? "Priority in the queue: answered first" : "Standard place in the queue"}</Feature>
        <Feature Icon={KeyRound}>Your own AI keys, with no limit</Feature>
      </ul>
      {onUpgrade && (
        <Button size="sm" className="mt-4 w-full" onClick={onUpgrade} disabled={disabled} icon={<Crown className="size-3.5" />}>
          Upgrade
        </Button>
      )}
    </div>
  );
}

/**
 * The user's plan next to the others. Plans only limit the built-in AI; Pro
 * comes from a one-time code (there is no payment flow).
 */
export default function PlanCard({ user }: { user: IUser }) {
  const [upgrading, setUpgrading] = useState(false);
  const plans = user.plans ?? (user.plan ? [user.plan] : []);
  if (!user.plan || !plans.length) return null;
  const isPro = user.plan.id === "pro";
  const pro = plans.find((plan) => plan.id === "pro");
  const free = plans.find((plan) => plan.id === "free");

  return (
    <section
      aria-disabled={!BUILTIN_AI_ENABLED || undefined}
      className={cn("rounded-3xl border border-line bg-surface p-5 sm:p-6", !BUILTIN_AI_ENABLED && "opacity-60 select-none")}
    >
      <h2 className="font-semibold text-fg">Plan</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Your plan sets how much of the {BUILTIN_AI_LABEL} you get. A session starts with your first question; questions, chat
        and summaries count, indexing your notes doesn&apos;t.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {plans.map((plan) => (
          <PlanColumn
            key={plan.id}
            plan={plan}
            current={plan.id === user.plan?.id}
            disabled={!BUILTIN_AI_ENABLED}
            onUpgrade={!isPro && plan.id === "pro" ? () => setUpgrading(true) : undefined}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-fg-subtle">
        {!BUILTIN_AI_ENABLED
          ? `The ${BUILTIN_AI_LABEL} isn't available here, so plans don't apply.`
          : isPro
            ? "You're on Pro: your questions go first when the built-in AI is busy."
            : "Have a Pro code? Choose Upgrade to redeem it."}
      </p>

      {BUILTIN_AI_ENABLED && pro && !isPro && <UpgradeModal open={upgrading} onClose={() => setUpgrading(false)} user={user} pro={pro} free={free} />}
    </section>
  );
}
