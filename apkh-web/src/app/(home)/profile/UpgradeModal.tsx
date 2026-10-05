"use client";

import { useState } from "react";
import { CircleAlert, Crown, KeyRound, ListOrdered, Sparkles } from "lucide-react";
import { redeemVoucher } from "@/services/authService";
import { getErrorMessage } from "@/services/axios";
import { useAppDispatch } from "@/store/hook";
import { setUser } from "@/store/slices/authSlice";
import { BUILTIN_AI_LABEL, IPlan, IUser } from "@/models/user";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { CodeInput, isCodeComplete } from "@/components/ui/CodeInput";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n";

const CODE_LENGTH = 8;

function Feature({ Icon, title, detail }: { Icon: typeof Sparkles; title: React.ReactNode; detail: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{detail}</p>
      </div>
    </li>
  );
}

/** What Pro adds, and a one-time "XXXX-XXXX" code to redeem it. */
export default function UpgradeModal({
  open,
  onClose,
  user,
  pro,
  free,
}: {
  open: boolean;
  onClose: () => void;
  user: IUser;
  pro: IPlan;
  free: IPlan | undefined;
}) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const t = useT();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const complete = isCodeComplete(code, CODE_LENGTH);

  const close = () => {
    setCode("");
    setError(null);
    onClose();
  };

  async function redeem() {
    if (!complete || redeeming) return;
    setRedeeming(true);
    setError(null);
    try {
      const updatedUser = await redeemVoucher(code);
      dispatch(setUser({ ...user, ...updatedUser }));
      toast(t("upgrade.done"), "success");
      close();
    } catch (err) {
      setError(getErrorMessage(err, t("upgrade.failed")));
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      locked={redeeming}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <Crown className="size-5 text-amber-500" /> {t("upgrade.title")}
        </span>
      }
      description={t("upgrade.description")}
    >
      <div className="overflow-x-hidden overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
        <ul className="space-y-3">
          <Feature
            Icon={Sparkles}
            title={t("upgrade.tokens", { tokens: pro.sessionTokens, name: BUILTIN_AI_LABEL })}
            detail={
              free
                ? t("upgrade.vsFree", { times: Math.round(pro.sessionTokens / free.sessionTokens), free: free.sessionTokens, hours: pro.sessionHours })
                : t("upgrade.every", { hours: pro.sessionHours })
            }
          />
          <Feature Icon={ListOrdered} title={t("upgrade.priority")} detail={t("upgrade.priorityText")} />
          <Feature Icon={KeyRound} title={t("plan.ownKeys")} detail={t("upgrade.keysText")} />
        </ul>

        <form
          className="mt-6 border-t border-line pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void redeem();
          }}
        >
          <p className="text-sm font-medium text-fg">{t("upgrade.enter")}</p>
          <p className="mt-0.5 text-xs text-fg-subtle">{t("upgrade.format")}</p>
          <div className="mt-4">
            <CodeInput
              value={code}
              length={CODE_LENGTH}
              onChange={(next) => {
                setCode(next);
                setError(null);
              }}
              onComplete={() => void redeem()}
              disabled={redeeming}
              invalid={Boolean(error)}
            />
          </div>
          {error && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" role="alert">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="[overflow-wrap:anywhere]">{error}</span>
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={redeeming}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!complete} loading={redeeming}>
              {redeeming ? t("upgrade.redeeming") : t("upgrade.redeem")}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
