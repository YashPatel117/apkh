"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Mail, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  createIntegrationToken,
  getIntegrations,
  Integrations,
  IntegrationToken,
  removeInbox,
  revokeIntegrationToken,
  rotateInbox,
} from "@/services/integrationService";
import { API_URL, getErrorMessage } from "@/services/axios";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => {},
        )
      }
      icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    >
      {copied ? t("int.copied") : (label ?? t("int.copy"))}
    </Button>
  );
}

type Pending = { kind: "token"; token: IntegrationToken } | { kind: "inbox-remove" } | { kind: "inbox-rotate" } | null;

/**
 * Ways in from outside: API tokens (webhooks, Zapier/Make, the browser
 * clipper) and an email address whose messages become notes.
 */
export default function IntegrationsCard() {
  const toast = useToast();
  const t = useT();
  const [data, setData] = useState<Integrations | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(() => {
    getIntegrations()
      .then(setData)
      .catch((err) => setError(getErrorMessage(err, t("int.loadFailed"))));
  }, [t]);
  useEffect(load, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await createIntegrationToken(name.trim());
      setNewToken(created.token);
      setName("");
      load();
    } catch (err) {
      toast(getErrorMessage(err, t("int.createFailed")), "error");
    } finally {
      setCreating(false);
    }
  };

  const createInbox = async () => {
    setInboxBusy(true);
    try {
      const inbox = await rotateInbox();
      setData((prev) => prev && { ...prev, inbox });
    } catch (err) {
      toast(getErrorMessage(err, t("int.inboxFailed")), "error");
      throw err;
    } finally {
      setInboxBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    try {
      if (pending.kind === "token") {
        await revokeIntegrationToken(pending.token.id);
        setData((prev) => prev && { ...prev, tokens: prev.tokens.filter((t) => t.id !== pending.token.id) });
        toast(t("int.revoked"), "success");
      } else if (pending.kind === "inbox-remove") {
        await removeInbox();
        setData((prev) => prev && { ...prev, inbox: null });
        toast(t("int.inboxOff"), "success");
      } else {
        await createInbox();
        toast(t("int.rotated"), "success");
      }
    } catch (err) {
      if (pending.kind !== "inbox-rotate") toast(getErrorMessage(err, t("int.failed")), "error");
      throw err;
    }
  };

  const example = `curl -X POST ${API_URL}/integrations/notes \\
  -H "Authorization: Bearer ${newToken ?? "apkh_…"}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"From a webhook","content":"Hello **world**","format":"markdown"}'`;

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Plug className="size-[1.1rem]" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-fg">{t("int.title")}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">{t("int.intro")}</p>
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-rose-600 dark:text-rose-400">{error}</p>
      ) : !data ? (
        <div className="flex justify-center py-6 text-fg-subtle">
          <Spinner />
        </div>
      ) : (
        <>
          {/* Tokens */}
          <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold text-fg">
            <KeyRound className="size-4 text-fg-subtle" /> {t("int.tokens")}
          </h3>
          <form onSubmit={(e) => void create(e)} className="mt-2 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder={t("int.tokenPlaceholder")}
              aria-label={t("int.tokenName")}
              className={cn(fieldClass, "h-9 min-w-0 flex-1")}
            />
            <Button type="submit" size="sm" className="h-9" loading={creating} disabled={!name.trim()} icon={<Plus className="size-3.5" />}>
              {t("int.create")}
            </Button>
          </form>

          {newToken && (
            <div className="mt-3 rounded-2xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
              <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">{t("int.copyNow")}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-2 py-1.5 font-mono text-xs text-fg select-all">{newToken}</code>
                <CopyButton text={newToken} />
              </div>
            </div>
          )}

          {data.tokens.length > 0 && (
            <ul className="mt-3 divide-y divide-line">
              {data.tokens.map((token) => (
                <li key={token.id} className="flex items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-fg">{token.name}</p>
                    <p className="text-xs text-fg-subtle">
                      <span className="font-mono">{token.prefix}…</span> · {t("int.created", { date: dateFormat.format(new Date(token.createdAt)) })}
                      {" · "}
                      {token.lastUsedAt ? t("int.lastUsed", { date: dateFormat.format(new Date(token.lastUsedAt)) }) : t("int.neverUsed")}
                    </p>
                  </div>
                  <Button variant="ghost-danger" size="icon-sm" onClick={() => setPending({ kind: "token", token })} aria-label={t("int.revokeName", { name: token.name })}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <details className="mt-3 text-xs text-fg-muted">
            <summary className="cursor-pointer font-medium text-fg-muted hover:text-fg">{t("int.howTo")}</summary>
            <p className="mt-2">{t("int.howToText")}</p>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 p-3 text-[0.7rem] leading-relaxed text-slate-100">{example}</pre>
            <p className="mt-2">{t("int.clipperText")}</p>
          </details>

          {/* Email */}
          <h3 className="mt-6 flex items-center gap-2 text-sm font-semibold text-fg">
            <Mail className="size-4 text-fg-subtle" /> {t("int.email")}
          </h3>
          {data.inbox ? (
            <div className="mt-2 space-y-2">
              {data.inbox.address ? (
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1.5 font-mono text-xs text-fg select-all">{data.inbox.address}</code>
                  <CopyButton text={data.inbox.address} />
                </div>
              ) : (
                <p className="text-xs text-fg-muted">{t("int.noDomain")}</p>
              )}
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1.5 font-mono text-xs text-fg-muted select-all">
                  {data.inbox.webhookUrl}
                </code>
                <CopyButton text={data.inbox.webhookUrl} label={t("int.copyUrl")} />
              </div>
              <p className="text-xs text-fg-subtle">{t("int.emailHint")}</p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPending({ kind: "inbox-rotate" })} icon={<RefreshCw className="size-3.5" />}>
                  {t("int.newAddress")}
                </Button>
                <Button variant="ghost-danger" size="sm" onClick={() => setPending({ kind: "inbox-remove" })} icon={<Trash2 className="size-3.5" />}>
                  {t("int.turnOff")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <p className="text-xs text-fg-muted">{t("int.inboxIntro")}</p>
              <Button variant="secondary" size="sm" className="mt-2" loading={inboxBusy} onClick={() => void createInbox().catch(() => {})} icon={<Mail className="size-3.5" />}>
                {t("int.createInbox")}
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(pending)}
        title={t(pending?.kind === "token" ? "int.revokeTitle" : pending?.kind === "inbox-remove" ? "int.removeTitle" : "int.rotateTitle")}
        message={
          pending?.kind === "token"
            ? t("int.revokeText", { name: pending.token.name })
            : t(pending?.kind === "inbox-remove" ? "int.removeText" : "int.rotateText")
        }
        confirmLabel={t(pending?.kind === "token" ? "int.revoke" : pending?.kind === "inbox-remove" ? "int.turnOff" : "int.replace")}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </section>
  );
}
