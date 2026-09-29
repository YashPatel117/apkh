"use client";

import { useState } from "react";
import { ChevronDown, CircleCheck, CircleAlert, Coins, ExternalLink, KeyRound, Plus, PlugZap, Tag, Trash2 } from "lucide-react";
import { testLlmSettings, addLlmConfig, activateLlmConfig, deleteLlmConfig } from "@/service/authService";
import { getErrorMessage } from "@/service/axios/axios";
import { useAppDispatch } from "@/store/hook";
import { setUser } from "@/store/slices/authSlice";
import { ILlmConfig, IUser } from "@/app/common/models/user";
import { Button } from "@/app/common/ui/Button";
import { Input, fieldClass } from "@/app/common/ui/Input";
import { ConfirmDialog } from "@/app/common/ui/ConfirmDialog";
import { useToast } from "@/app/common/ui/Toast";
import { Spinner } from "@/app/common/ui/Spinner";
import { cn } from "@/app/common/ui/cn";

// ── Provider catalogue ───────────────────────────────────────────────────────
const PROVIDER_GROUPS = [
  {
    label: "Google Gemini",
    prefix: "gemini",
    docsUrl: "https://aistudio.google.com/app/apikey",
    models: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
  },
  {
    label: "OpenAI",
    prefix: "gpt",
    docsUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  },
  {
    label: "Anthropic Claude",
    prefix: "claude",
    docsUrl: "https://console.anthropic.com/settings/keys",
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
  },
];

function detectProvider(model: string) {
  return PROVIDER_GROUPS.find((g) => model.toLowerCase().startsWith(g.prefix)) ?? null;
}

type TestStatus = "idle" | "testing" | "ok" | "error";

// ── Saved config row ─────────────────────────────────────────────────────────
function ConfigRow({
  config,
  onActivate,
  onDelete,
}: {
  config: ILlmConfig;
  onActivate: (keyName: string) => Promise<void>;
  onDelete: (config: ILlmConfig) => void;
}) {
  const [activating, setActivating] = useState(false);
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
        aria-label={config.isActive ? `${config.keyName} is active` : `Use ${config.keyName}`}
        className={cn(
          "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors disabled:cursor-default",
          !config.isActive && "hover:bg-surface-2",
        )}
      >
        {activating ? (
          <Spinner className="size-4 text-accent" />
        ) : (
          <span
            className={cn(
              "flex size-[1.1rem] items-center justify-center rounded-full border-2",
              config.isActive ? "border-accent" : "border-fg-subtle",
            )}
          >
            {config.isActive && <span className="size-2 rounded-full bg-accent" />}
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-fg">{config.keyName}</p>
          {config.isActive && (
            <span className="rounded-md bg-indigo-600 px-1.5 py-0.5 text-[0.62rem] font-bold tracking-wider text-white uppercase dark:bg-indigo-500">
              Active
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-fg-subtle">
          {config.llmModel}
          {provider && ` · ${provider.label}`}
        </p>
      </div>

      <span className="hidden items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-xs font-medium text-fg-muted tabular-nums sm:inline-flex" title="Tokens used">
        <Coins className="size-3" />
        {config.tokensUsed.toLocaleString()}
      </span>

      <Button size="icon-sm" variant="ghost-danger" onClick={() => onDelete(config)} aria-label={`Remove ${config.keyName}`}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

// ── Main card ────────────────────────────────────────────────────────────────
export default function LlmSettingsCard({ user }: { user: IUser }) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const configs: ILlmConfig[] = user.llmConfigs ?? [];
  const [showForm, setShowForm] = useState(configs.length === 0);
  const [pendingDelete, setPendingDelete] = useState<ILlmConfig | null>(null);

  const [keyName, setKeyName] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [customModel, setCustomModel] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeModel = useCustom ? customModel.trim() : model;
  const provider = detectProvider(activeModel);
  const canTest = keyName.trim().length > 0 && activeModel.length > 0 && apiKey.trim().length > 0;
  const canSave = testStatus === "ok" && canTest && !saving;

  const resetTest = () => {
    setTestStatus("idle");
    setTestError(null);
  };

  function resetForm() {
    setKeyName("");
    setModel("gemini-2.5-flash");
    setCustomModel("");
    setUseCustom(false);
    setApiKey("");
    resetTest();
    setShowForm(false);
  }

  async function handleTest() {
    setTestStatus("testing");
    setTestError(null);
    try {
      const result = await testLlmSettings({ apiKey: apiKey.trim(), model: activeModel });
      setTestStatus(result.ok ? "ok" : "error");
      if (!result.ok) setTestError(result.error ?? "Connection failed.");
    } catch (err) {
      setTestStatus("error");
      setTestError(getErrorMessage(err, "Could not reach the server."));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updatedUser = await addLlmConfig({ keyName: keyName.trim(), apiKey: apiKey.trim(), model: activeModel, setActive: true });
      dispatch(setUser({ ...user, ...updatedUser }));
      toast(`“${keyName.trim()}” saved and set as active.`, "success");
      resetForm();
    } catch (err) {
      setTestError(getErrorMessage(err, "Save failed. Please try again."));
      setTestStatus("error");
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(name: string) {
    try {
      const updatedUser = await activateLlmConfig(name);
      dispatch(setUser({ ...user, ...updatedUser }));
      toast(`Now using “${name}”.`, "success");
    } catch (err) {
      toast(getErrorMessage(err, "Couldn't switch configs."), "error");
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      const updatedUser = await deleteLlmConfig(pendingDelete.keyName);
      dispatch(setUser({ ...user, ...updatedUser }));
      toast("Config removed.", "success");
    } catch (err) {
      toast(getErrorMessage(err, "Couldn't remove the config."), "error");
      throw err;
    }
  }

  return (
    <section id="ai" className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-fg">AI models</h2>
          <p className="mt-1 text-sm text-fg-muted">Bring your own key. The active config powers search, summaries and chat.</p>
        </div>
        {!showForm && (
          <Button size="sm" variant="soft" onClick={() => setShowForm(true)} icon={<Plus className="size-3.5" />}>
            Add
          </Button>
        )}
      </div>

      {configs.length > 0 && (
        <div role="radiogroup" aria-label="Saved AI configs" className="mt-5 space-y-2">
          {configs.map((cfg) => (
            <ConfigRow key={cfg.keyName} config={cfg} onActivate={handleActivate} onDelete={setPendingDelete} />
          ))}
        </div>
      )}

      {showForm && (
        <div className={cn("space-y-4", configs.length > 0 ? "mt-5 border-t border-line pt-5" : "mt-5")}>
          <h3 className="text-sm font-semibold text-fg">New config</h3>

          <Input
            label="Name"
            icon={<Tag />}
            placeholder="e.g. Work Gemini"
            value={keyName}
            onChange={(e) => {
              setKeyName(e.target.value);
              resetTest();
            }}
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Provider</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Provider">
              {PROVIDER_GROUPS.map((pg) => {
                const selected = !useCustom && detectProvider(model)?.prefix === pg.prefix;
                return (
                  <button
                    key={pg.prefix}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setUseCustom(false);
                      setModel(pg.models[0]);
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
              <button
                type="button"
                role="radio"
                aria-checked={useCustom}
                onClick={() => {
                  setUseCustom(true);
                  resetTest();
                }}
                className={cn(
                  "cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                  useCustom ? "border-accent bg-accent-soft text-accent-fg" : "border-line text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                Custom
              </button>
            </div>
          </div>

          {useCustom ? (
            <Input
              label="Model identifier"
              placeholder="e.g. gpt-4o"
              value={customModel}
              onChange={(e) => {
                setCustomModel(e.target.value);
                resetTest();
              }}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="llm-model" className="text-sm font-medium text-fg">
                Model
              </label>
              <div className="relative">
                <select
                  id="llm-model"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    resetTest();
                  }}
                  className={cn(fieldClass, "h-11 cursor-pointer appearance-none pr-10")}
                >
                  {(provider?.models ?? PROVIDER_GROUPS[0].models).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-fg-subtle" />
              </div>
            </div>
          )}

          <Input
            label="API key"
            type="password"
            icon={<KeyRound />}
            placeholder="Paste your API key"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              resetTest();
            }}
            hint={
              provider ? (
                <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                  Get a {provider.label} API key <ExternalLink className="size-3" />
                </a>
              ) : undefined
            }
          />

          {testStatus === "ok" && (
            <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" role="status">
              <CircleCheck className="size-4 shrink-0" /> Connection works — you can save now.
            </p>
          )}
          {testStatus === "error" && testError && (
            <p className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" role="alert">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{testError}</span>
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {testStatus === "ok" ? (
              <Button onClick={handleSave} disabled={!canSave} loading={saving}>
                {saving ? "Saving…" : "Save & activate"}
              </Button>
            ) : (
              <Button onClick={handleTest} disabled={!canTest} loading={testStatus === "testing"} icon={<PlugZap className="size-4" />}>
                {testStatus === "testing" ? "Testing…" : "Test connection"}
              </Button>
            )}
            {configs.length > 0 && (
              <Button variant="ghost" onClick={resetForm} disabled={saving}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove this AI config?"
        message={
          <>
            The key <span className="font-semibold text-fg">“{pendingDelete?.keyName}”</span> will be deleted.
            {pendingDelete?.isActive && " AI features will be off until you activate another config."}
          </>
        }
        confirmLabel="Remove"
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </section>
  );
}
