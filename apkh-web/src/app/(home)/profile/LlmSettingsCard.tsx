"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleCheck, CircleAlert, Coins, ExternalLink, KeyRound, Link2, Pencil, Plus, PlugZap, Tag, Trash2 } from "lucide-react";
import { testLlmSettings, addLlmConfig, activateLlmConfig, deleteLlmConfig, listLlmModels, switchToBuiltinAi } from "@/services/authService";
import { getErrorMessage } from "@/services/axios";
import { useAppDispatch } from "@/store/hook";
import { setUser } from "@/store/slices/authSlice";
import {
  BUILTIN_AI_LABEL,
  builtinAiOf,
  IBuiltinAiUsage,
  ILlmConfig,
  ILlmModel,
  IPlan,
  IUser,
  LlmProvider,
  providerOfModel,
  timeUntil,
} from "@/models/user";
import { Button } from "@/components/ui/Button";
import { Input, fieldClass } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { exchangeOpenrouterCode, startOpenrouterConnect, takeOpenrouterCallback } from "@/lib/openrouterConnect";
import { useT } from "@/i18n";

// ── Provider catalogue ───────────────────────────────────────────────────────
// Models are not listed here: they are fetched live from the provider with the
// user's key, so new releases appear and retired models disappear on their own.
// OpenRouter lists its free models. The built-in AI needs no key, so it has a
// row of its own instead of a place in this form.
const PROVIDER_GROUPS: { id: Exclude<LlmProvider, "builtin">; label: string; docsUrl: string }[] = [
  { id: "openrouter", label: "OpenRouter", docsUrl: "https://openrouter.ai/keys" },
  { id: "gemini", label: "Google Gemini", docsUrl: "https://aistudio.google.com/app/apikey" },
  { id: "openai", label: "OpenAI", docsUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic Claude", docsUrl: "https://console.anthropic.com/settings/keys" },
];

// "Connect OpenRouter" saves its key under this name, replacing it on a reconnect.
const OPENROUTER_CONNECT_NAME = "OpenRouter";
// Free models come and go and some are rate-limited; try a few before giving up.
const OPENROUTER_MODELS_TO_TRY = 5;

// Shorter input is still being typed or pasted; don't query the provider yet.
const MIN_KEY_LENGTH = 20;

function detectProvider(model: string) {
  const id = providerOfModel(model);
  return PROVIDER_GROUPS.find((g) => g.id === id) ?? null;
}

function modelOptionLabel(model: ILlmModel) {
  return model.label && model.label !== model.id ? `${model.label} (${model.id})` : model.id;
}

type TestStatus = "idle" | "testing" | "ok" | "error";

function RadioDot({ checked, busy }: { checked: boolean; busy: boolean }) {
  if (busy) return <Spinner className="size-4 text-accent" />;
  return (
    <span className={cn("flex size-[1.1rem] items-center justify-center rounded-full border-2", checked ? "border-accent" : "border-fg-subtle")}>
      {checked && <span className="size-2 rounded-full bg-accent" />}
    </span>
  );
}

function ActiveBadge() {
  const t = useT();
  return (
    <span className="rounded-md bg-indigo-600 px-1.5 py-0.5 text-[0.62rem] font-bold tracking-wider text-white uppercase dark:bg-indigo-500">
      {t("llm.active")}
    </span>
  );
}

// ── Built-in AI row ──────────────────────────────────────────────────────────
function BuiltinAiRow({
  active,
  usage,
  plan,
  onActivate,
}: {
  active: boolean;
  usage: IBuiltinAiUsage;
  plan: IPlan | undefined;
  onActivate: () => Promise<void>;
}) {
  const [activating, setActivating] = useState(false);
  const t = useT();
  const share = usage.sessionLimit > 0 ? Math.min(1, usage.sessionTokens / usage.sessionLimit) : 0;
  const exhausted = usage.sessionTokens >= usage.sessionLimit;

  async function handleActivate() {
    if (active || activating) return;
    setActivating(true);
    try {
      await onActivate();
    } finally {
      setActivating(false);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-3 transition-colors",
        active ? "border-indigo-200 bg-accent-soft dark:border-indigo-400/30" : "border-line bg-surface",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={handleActivate}
        disabled={active || activating}
        aria-label={t(active ? "llm.isActive" : "llm.use", { name: BUILTIN_AI_LABEL })}
        className={cn(
          "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors disabled:cursor-default",
          !active && "hover:bg-surface-2",
        )}
      >
        <RadioDot checked={active} busy={activating} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-fg">{BUILTIN_AI_LABEL}</p>
          {plan && (
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.62rem] font-bold tracking-wider text-fg-muted uppercase">
              {t("nav.plan", { plan: plan.label })}
            </span>
          )}
          {active && <ActiveBadge />}
        </div>
        <p className="mt-0.5 text-xs text-fg-subtle">{t("llm.builtinHint")}</p>

        {/* This session's allowance */}
        <div className="mt-2.5">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-label={t("llm.builtinUsedLabel")}
            aria-valuemin={0}
            aria-valuemax={usage.sessionLimit}
            aria-valuenow={usage.sessionTokens}
          >
            <div
              className={cn("h-full rounded-full transition-[width]", exhausted ? "bg-rose-500" : share > 0.8 ? "bg-amber-500" : "bg-accent")}
              style={{ width: `${share * 100}%` }}
            />
          </div>
          <p className={cn("mt-1 text-xs tabular-nums", exhausted ? "text-rose-600 dark:text-rose-400" : "text-fg-subtle")}>
            {t("llm.sessionUsage", { used: usage.sessionTokens, limit: usage.sessionLimit })}
            {usage.sessionResetsAt
              ? ` · ${t("llm.resetsIn", { time: timeUntil(usage.sessionResetsAt) })}`
              : plan
                ? ` · ${t("llm.sessionLasts", { hours: plan.sessionHours })}`
                : ""}
          </p>
        </div>
      </div>

      <span
        className="hidden items-center gap-1 self-start rounded-lg bg-surface-2 px-2 py-1 text-xs font-medium text-fg-muted tabular-nums sm:inline-flex"
        title={t("llm.totalTokens")}
      >
        <Coins className="size-3" />
        {usage.totalTokens.toLocaleString()}
      </span>
    </div>
  );
}
type ModelRequest = { provider: LlmProvider; apiKey?: string; keyName?: string };
type LoadedModels = { request: ModelRequest; ok: boolean; items: ILlmModel[]; error: string | null };

// ── Saved config row ─────────────────────────────────────────────────────────
function ConfigRow({
  config,
  onActivate,
  onEdit,
  onDelete,
}: {
  config: ILlmConfig;
  onActivate: (keyName: string) => Promise<void>;
  onEdit: (config: ILlmConfig) => void;
  onDelete: (config: ILlmConfig) => void;
}) {
  const [activating, setActivating] = useState(false);
  const t = useT();
  const provider = detectProvider(config.llmModel);

  async function handleActivate() {
    if (config.isActive || activating) return;
    setActivating(true);
    try {
      await onActivate(config.keyName);
    } finally {
      setActivating(false);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-3 transition-colors",
        config.isActive ? "border-indigo-200 bg-accent-soft dark:border-indigo-400/30" : "border-line bg-surface",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={config.isActive}
        onClick={handleActivate}
        disabled={config.isActive || activating}
        aria-label={t(config.isActive ? "llm.isActive" : "llm.use", { name: config.keyName })}
        className={cn(
          "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors disabled:cursor-default",
          !config.isActive && "hover:bg-surface-2",
        )}
      >
        <RadioDot checked={config.isActive} busy={activating} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-fg">{config.keyName}</p>
          {config.isActive && <ActiveBadge />}
        </div>
        <p className="mt-0.5 truncate text-xs text-fg-subtle">
          {config.llmModel}
          {provider && ` · ${provider.label}`}
        </p>
      </div>

      <span className="hidden items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-xs font-medium text-fg-muted tabular-nums sm:inline-flex" title={t("llm.tokensUsed")}>
        <Coins className="size-3" />
        {config.tokensUsed.toLocaleString()}
      </span>

      <Button size="icon-sm" variant="ghost" onClick={() => onEdit(config)} aria-label={t("llm.changeModelFor", { name: config.keyName })} title={t("llm.changeModel")}>
        <Pencil className="size-4" />
      </Button>
      <Button size="icon-sm" variant="ghost-danger" onClick={() => onDelete(config)} aria-label={t("llm.removeName", { name: config.keyName })}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

// ── Main card ────────────────────────────────────────────────────────────────
export default function LlmSettingsCard({ user }: { user: IUser }) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const t = useT();
  const configs: ILlmConfig[] = user.llmConfigs ?? [];
  const builtinAi = builtinAiOf(user);
  // Any saved OpenRouter key, connected or pasted, makes "Connect OpenRouter" redundant
  const hasOpenrouter = configs.some((c) => providerOfModel(c.llmModel) === "openrouter");
  const builtinAiActive =Boolean(builtinAi) && !configs.some((c) => c.isActive);
  const [showForm, setShowForm] = useState(configs.length === 0 && !builtinAi);
  const [pendingDelete, setPendingDelete] = useState<ILlmConfig | null>(null);

  // The saved config whose model is being changed; null when adding a new one.
  const [editing, setEditing] = useState<ILlmConfig | null>(null);
  const [keyName, setKeyName] = useState("");
  const [providerId, setProviderId] = useState<LlmProvider>(PROVIDER_GROUPS[0].id);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loaded, setLoaded] = useState<LoadedModels | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // "redirecting" to openrouter.ai, or "saving" its key on the way back
  const [connect, setConnect] = useState<"idle" | "redirecting" | "saving">("idle");

  const trimmedKey = apiKey.trim();
  const group = PROVIDER_GROUPS.find((g) => g.id === providerId) ?? PROVIDER_GROUPS[0];

  // When changing a saved config's model, its stored key is reused unless a new
  // key is typed, as long as the provider stays the same.
  const savedProviderId = editing ? detectProvider(editing.llmModel)?.id : undefined;
  const editingKeyName = editing?.keyName;
  const useSavedKey = Boolean(editingKeyName) && !trimmedKey && savedProviderId !== undefined && group.id === savedProviderId;

  const modelRequest = useMemo<ModelRequest | null>(() => {
    if (trimmedKey) return trimmedKey.length >= MIN_KEY_LENGTH ? { provider: providerId, apiKey: trimmedKey } : null;
    return useSavedKey ? { provider: providerId, keyName: editingKeyName } : null;
  }, [providerId, trimmedKey, useSavedKey, editingKeyName]);

  useEffect(() => {
    if (!modelRequest) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      listLlmModels(modelRequest)
        .then((res) => {
          if (!cancelled) setLoaded({ request: modelRequest, ok: res.ok, items: res.models ?? [], error: res.error });
        })
        .catch((err) => {
          if (!cancelled) setLoaded({ request: modelRequest, ok: false, items: [], error: getErrorMessage(err, t("llm.loadModelsFailed")) });
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [modelRequest, t]);

  const current = loaded && loaded.request === modelRequest ? loaded : null;
  const modelsStatus = !modelRequest ? "idle" : !current ? "loading" : current.ok ? "ok" : "error";
  const models = current?.ok ? current.items : [];
  const selectedModel = models.some((m) => m.id === model) ? model : "";
  const savedModelRetired =
    modelsStatus === "ok" && editing !== null && providerId === savedProviderId && !models.some((m) => m.id === editing.llmModel);

  const activeModel = selectedModel;
  const hasKey = Boolean(trimmedKey) || useSavedKey;
  const canTest = keyName.trim().length > 0 && activeModel.length > 0 && hasKey;
  const canSave = testStatus === "ok" && canTest && !saving;
  const keySource = trimmedKey ? { apiKey: trimmedKey } : { keyName: editingKeyName };

  const resetTest = () => {
    setTestStatus("idle");
    setTestError(null);
  };

  function resetForm() {
    setEditing(null);
    setKeyName("");
    setProviderId(PROVIDER_GROUPS[0].id);
    setModel("");
    setApiKey("");
    resetTest();
    setShowForm(false);
  }

  function startEdit(config: ILlmConfig) {
    const provider = detectProvider(config.llmModel);
    setEditing(config);
    setKeyName(config.keyName);
    setProviderId(provider?.id ?? PROVIDER_GROUPS[0].id);
    setModel(config.llmModel);
    setApiKey("");
    resetTest();
    setShowForm(true);
  }

  async function handleTest() {
    setTestStatus("testing");
    setTestError(null);
    try {
      const result = await testLlmSettings({ ...keySource, model: activeModel });
      setTestStatus(result.ok ? "ok" : "error");
      if (!result.ok) setTestError(result.error ?? t("llm.connectionFailed"));
    } catch (err) {
      setTestStatus("error");
      setTestError(getErrorMessage(err, t("llm.unreachable")));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const name = keyName.trim();
      const updatedUser = await addLlmConfig({ keyName: name, apiKey: trimmedKey || undefined, model: activeModel, setActive: true });
      dispatch(setUser({ ...user, ...updatedUser }));
      toast(editing ? t("llm.updated", { name, model: activeModel }) : t("llm.saved", { name }), "success");
      resetForm();
    } catch (err) {
      setTestError(getErrorMessage(err, t("llm.saveFailed")));
      setTestStatus("error");
    } finally {
      setSaving(false);
    }
  }

  // Back from openrouter.ai: exchange the code for a key, then save it with
  // the first free model that answers, as the active config.
  useEffect(() => {
    const callback = takeOpenrouterCallback();
    if (!callback) return;
    setConnect("saving");
    (async () => {
      try {
        const key = await exchangeOpenrouterCode(callback.code, callback.verifier);
        const listed = await listLlmModels({ provider: "openrouter", apiKey: key });
        if (!listed.ok || !listed.models.length) throw new Error(listed.error ?? t("llm.noFreeModels"));

        let chosen: string | null = null;
        for (const candidate of listed.models.slice(0, OPENROUTER_MODELS_TO_TRY)) {
          if ((await testLlmSettings({ apiKey: key, model: candidate.id })).ok) {
            chosen = candidate.id;
            break;
          }
        }
        if (!chosen) throw new Error(t("llm.noneAnswered"));

        const updatedUser = await addLlmConfig({ keyName: OPENROUTER_CONNECT_NAME, apiKey: key, model: chosen, setActive: true });
        dispatch(setUser({ ...user, ...updatedUser }));
        toast(t("llm.orConnected", { model: chosen }), "success");
      } catch (err) {
        toast(getErrorMessage(err, t("llm.orFailed")), "error");
      } finally {
        setConnect("idle");
      }
    })();
    // Runs once per page load; the callback code is single-use
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnectOpenrouter() {
    setConnect("redirecting");
    try {
      await startOpenrouterConnect();
    } catch {
      setConnect("idle");
      toast(t("llm.orStartFailed"), "error");
    }
  }

  async function handleActivate(name: string) {
    try {
      const updatedUser = await activateLlmConfig(name);
      dispatch(setUser({ ...user, ...updatedUser }));
      toast(t("llm.nowUsing", { name }), "success");
    } catch (err) {
      toast(getErrorMessage(err, t("llm.switchFailed")), "error");
    }
  }

  async function handleUseBuiltinAi() {
    try {
      const updatedUser = await switchToBuiltinAi();
      dispatch(setUser({ ...user, ...updatedUser }));
      toast(t("llm.nowBuiltin", { name: BUILTIN_AI_LABEL }), "success");
    } catch (err) {
      toast(getErrorMessage(err, t("llm.builtinFailed")), "error");
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      const updatedUser = await deleteLlmConfig(pendingDelete.keyName);
      dispatch(setUser({ ...user, ...updatedUser }));
      toast(t("llm.removed"), "success");
    } catch (err) {
      toast(getErrorMessage(err, t("llm.removeFailed")), "error");
      throw err;
    }
  }

  const modelPlaceholder = {
    idle: t("llm.phIdle"),
    loading: t("llm.phLoading"),
    error: t("llm.phError"),
    ok: models.length > 0 ? t("llm.phChoose") : t("llm.phNone"),
  }[modelsStatus];

  return (
    <section id="ai" className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-fg">{t("llm.title")}</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {builtinAi ? t("llm.introBuiltin") : t("llm.introKey")}
          </p>
        </div>
        {(!hasOpenrouter || !showForm) && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {!hasOpenrouter && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleConnectOpenrouter()}
                loading={connect !== "idle"}
                icon={<Link2 className="size-3.5" />}
              >
                {t("llm.connectOr")}
              </Button>
            )}
            {!showForm && (
              <Button size="sm" variant="soft" onClick={() => setShowForm(true)} icon={<Plus className="size-3.5" />}>
                {t("llm.addKey")}
              </Button>
            )}
          </div>
        )}
      </div>

      {connect === "saving" && (
        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-accent-soft p-4 text-sm text-accent-fg" aria-live="polite">
          <Spinner className="size-4" />
          {t("llm.connecting")}
        </div>
      )}

      {(configs.length > 0 || builtinAi) && (
        <div role="radiogroup" aria-label={t("llm.configs")} className="mt-5 space-y-2">
          {builtinAi && <BuiltinAiRow active={builtinAiActive} usage={builtinAi} plan={user.plan} onActivate={handleUseBuiltinAi} />}
          {configs.map((cfg) => (
            <ConfigRow key={cfg.keyName} config={cfg} onActivate={handleActivate} onEdit={startEdit} onDelete={setPendingDelete} />
          ))}
        </div>
      )}

      {showForm && (
        <div className={cn("space-y-4", configs.length > 0 || builtinAi ? "mt-5 border-t border-line pt-5" : "mt-5")}>
          <h3 className="text-sm font-semibold text-fg">{editing ? t("llm.changeModelTitle", { name: editing.keyName }) : t("llm.newConfig")}</h3>

          <Input
            label={t("llm.name")}
            icon={<Tag />}
            placeholder={t("llm.namePh")}
            value={keyName}
            disabled={Boolean(editing)}
            onChange={(e) => {
              setKeyName(e.target.value);
              resetTest();
            }}
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">{t("llm.provider")}</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("llm.provider")}>
              {PROVIDER_GROUPS.map((pg) => {
                const selected = providerId === pg.id;
                return (
                  <button
                    key={pg.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setProviderId(pg.id);
                      setModel("");
                      resetTest();
                    }}
                    className={cn(
                      "cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                      selected ? "border-accent bg-accent-soft text-accent-fg" : "border-line text-fg-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    {pg.label}
                  </button>
                );
              })}
            </div>
          </div>

          <Input
            label={t("llm.apiKey")}
            type="password"
            icon={<KeyRound />}
            placeholder={editing ? t("llm.keyPhKeep") : t("llm.keyPh")}
            autoComplete="off"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              resetTest();
            }}
            hint={
              <a href={group.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                {t("llm.getKey", { provider: group.label })} <ExternalLink className="size-3" />
              </a>
            }
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="llm-model" className="text-sm font-medium text-fg">
              {t("llm.model")}
            </label>
            <div className="relative">
              <select
                id="llm-model"
                value={selectedModel}
                disabled={modelsStatus !== "ok" || models.length === 0}
                onChange={(e) => {
                  setModel(e.target.value);
                  resetTest();
                }}
                className={cn(fieldClass, "h-11 cursor-pointer appearance-none pr-10 disabled:cursor-default")}
              >
                <option value="" disabled>
                  {modelPlaceholder}
                </option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {modelOptionLabel(m)}
                  </option>
                ))}
              </select>
              {modelsStatus === "loading" ? (
                <Spinner className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-accent" />
              ) : (
                <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-fg-subtle" />
              )}
            </div>
            {modelsStatus === "error" && current?.error ? (
              <p className="text-xs [overflow-wrap:anywhere] text-rose-600 dark:text-rose-400" role="alert">
                {current.error}
              </p>
            ) : savedModelRetired && editing ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t("llm.retired", { model: editing.llmModel })}
              </p>
            ) : modelsStatus === "ok" && models.length > 0 ? (
              <p className="text-xs text-fg-subtle">
                {group.id === "openrouter" ? t("llm.freeList") : t("llm.liveList", { provider: group.label })}
              </p>
            ) : null}
          </div>

          {group.id === "openrouter" && (
            <p className="text-xs text-fg-subtle">{t("llm.orNote")}</p>
          )}

          {testStatus === "ok" && (
            <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" role="status">
              <CircleCheck className="size-4 shrink-0" /> {t("llm.works")}
            </p>
          )}
          {testStatus === "error" && testError && (
            <p className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" role="alert">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="max-h-40 min-w-0 flex-1 overflow-y-auto [overflow-wrap:anywhere]">{testError}</span>
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {testStatus === "ok" ? (
              <Button onClick={handleSave} disabled={!canSave} loading={saving}>
                {saving ? t("editor.saving") : t("llm.saveActivate")}
              </Button>
            ) : (
              <Button onClick={handleTest} disabled={!canTest} loading={testStatus === "testing"} icon={<PlugZap className="size-4" />}>
                {testStatus === "testing" ? t("llm.testing") : t("llm.test")}
              </Button>
            )}
            {(configs.length > 0 || builtinAi || editing) && (
              <Button variant="ghost" onClick={resetForm} disabled={saving}>
                {t("common.cancel")}
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t("llm.removeTitle")}
        message={
          <>
            {t("llm.removeMsg", { name: pendingDelete?.keyName ?? "" })}
            {pendingDelete?.isActive &&
              ` ${
                configs.length > 1
                  ? t("llm.removeNext", { name: configs.find((c) => c !== pendingDelete)?.keyName ?? "" })
                  : builtinAi
                    ? t("llm.removeBuiltin", { name: BUILTIN_AI_LABEL })
                    : t("llm.removeOff")
              }`}
          </>
        }
        confirmLabel={t("llm.removeConfirm")}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </section>
  );
}
