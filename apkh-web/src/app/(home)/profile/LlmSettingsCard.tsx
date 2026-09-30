"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleCheck, CircleAlert, Coins, ExternalLink, KeyRound, Pencil, Plus, PlugZap, Tag, Trash2 } from "lucide-react";
import { testLlmSettings, addLlmConfig, activateLlmConfig, deleteLlmConfig, listLlmModels } from "@/services/authService";
import { getErrorMessage } from "@/services/axios";
import { useAppDispatch } from "@/store/hook";
import { setUser } from "@/store/slices/authSlice";
import { ILlmConfig, ILlmModel, IUser, LlmProvider, providerOfModel } from "@/models/user";
import { Button } from "@/components/ui/Button";
import { Input, fieldClass } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

// ── Provider catalogue ───────────────────────────────────────────────────────
// Models are not listed here: they are fetched live from the provider with the
// user's key, so new releases appear and retired models disappear on their own.
const PROVIDER_GROUPS: { id: LlmProvider; label: string; docsUrl: string }[] = [
  { id: "gemini", label: "Google Gemini", docsUrl: "https://aistudio.google.com/app/apikey" },
  { id: "openai", label: "OpenAI", docsUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic Claude", docsUrl: "https://console.anthropic.com/settings/keys" },
];

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

      <Button size="icon-sm" variant="ghost" onClick={() => onEdit(config)} aria-label={`Change model for ${config.keyName}`} title="Change model">
        <Pencil className="size-4" />
      </Button>
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

  // The saved config whose model is being changed; null when adding a new one.
  const [editing, setEditing] = useState<ILlmConfig | null>(null);
  const [keyName, setKeyName] = useState("");
  const [providerId, setProviderId] = useState<LlmProvider | "custom">("gemini");
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loaded, setLoaded] = useState<LoadedModels | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmedKey = apiKey.trim();
  const isCustom = providerId === "custom";
  const group = isCustom ? detectProvider(customModel) : (PROVIDER_GROUPS.find((g) => g.id === providerId) ?? null);

  // When changing a saved config's model, its stored key is reused unless a new
  // key is typed, as long as the provider stays the same.
  const savedProviderId = editing ? detectProvider(editing.llmModel)?.id : undefined;
  const editingKeyName = editing?.keyName;
  const useSavedKey = Boolean(editingKeyName) && !trimmedKey && savedProviderId !== undefined && group?.id === savedProviderId;

  const modelRequest = useMemo<ModelRequest | null>(() => {
    if (providerId === "custom") return null;
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
          if (!cancelled) setLoaded({ request: modelRequest, ok: false, items: [], error: getErrorMessage(err, "Couldn't load models.") });
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [modelRequest]);

  const current = loaded && loaded.request === modelRequest ? loaded : null;
  const modelsStatus = !modelRequest ? "idle" : !current ? "loading" : current.ok ? "ok" : "error";
  const models = current?.ok ? current.items : [];
  const selectedModel = models.some((m) => m.id === model) ? model : "";
  const savedModelRetired =
    modelsStatus === "ok" && editing !== null && providerId === savedProviderId && !models.some((m) => m.id === editing.llmModel);

  const activeModel = isCustom ? customModel.trim() : selectedModel;
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
    setProviderId("gemini");
    setModel("");
    setCustomModel("");
    setApiKey("");
    resetTest();
    setShowForm(false);
  }

  function startEdit(config: ILlmConfig) {
    const provider = detectProvider(config.llmModel);
    setEditing(config);
    setKeyName(config.keyName);
    setProviderId(provider?.id ?? "custom");
    setModel(config.llmModel);
    setCustomModel(provider ? "" : config.llmModel);
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
      if (!result.ok) setTestError(result.error ?? "Connection failed.");
    } catch (err) {
      setTestStatus("error");
      setTestError(getErrorMessage(err, "Could not reach the server."));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const name = keyName.trim();
      const updatedUser = await addLlmConfig({ keyName: name, apiKey: trimmedKey || undefined, model: activeModel, setActive: true });
      dispatch(setUser({ ...user, ...updatedUser }));
      toast(editing ? `“${name}” now uses ${activeModel}.` : `“${name}” saved and set as active.`, "success");
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

  const modelPlaceholder = {
    idle: "Enter your API key to load models",
    loading: "Loading models…",
    error: "Couldn't load models",
    ok: models.length > 0 ? "Choose a model" : "No chat models available for this key",
  }[modelsStatus];

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
            <ConfigRow key={cfg.keyName} config={cfg} onActivate={handleActivate} onEdit={startEdit} onDelete={setPendingDelete} />
          ))}
        </div>
      )}

      {showForm && (
        <div className={cn("space-y-4", configs.length > 0 ? "mt-5 border-t border-line pt-5" : "mt-5")}>
          <h3 className="text-sm font-semibold text-fg">{editing ? `Change model for “${editing.keyName}”` : "New config"}</h3>

          <Input
            label="Name"
            icon={<Tag />}
            placeholder="e.g. Work Gemini"
            value={keyName}
            disabled={Boolean(editing)}
            onChange={(e) => {
              setKeyName(e.target.value);
              resetTest();
            }}
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Provider</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Provider">
              {[...PROVIDER_GROUPS, { id: "custom" as const, label: "Custom" }].map((pg) => {
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
            label="API key"
            type="password"
            icon={<KeyRound />}
            placeholder={editing ? "Leave blank to keep the saved key" : "Paste your API key"}
            autoComplete="off"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              resetTest();
            }}
            hint={
              group ? (
                <a href={group.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                  Get a {group.label} API key <ExternalLink className="size-3" />
                </a>
              ) : undefined
            }
          />

          {isCustom ? (
            <Input
              label="Model identifier"
              placeholder="e.g. gpt-4o"
              value={customModel}
              onChange={(e) => {
                setCustomModel(e.target.value);
                resetTest();
              }}
              hint="Any model ID starting with gemini-, gpt-, chatgpt-, o1/o3/…, or claude-."
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="llm-model" className="text-sm font-medium text-fg">
                Model
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
                  “{editing.llmModel}” is no longer offered to this key. Pick a current model.
                </p>
              ) : modelsStatus === "ok" && models.length > 0 ? (
                <p className="text-xs text-fg-subtle">Live list from {group?.label}, newest first.</p>
              ) : null}
            </div>
          )}

          {testStatus === "ok" && (
            <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" role="status">
              <CircleCheck className="size-4 shrink-0" /> Connection works — you can save now.
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
                {saving ? "Saving…" : "Save & activate"}
              </Button>
            ) : (
              <Button onClick={handleTest} disabled={!canTest} loading={testStatus === "testing"} icon={<PlugZap className="size-4" />}>
                {testStatus === "testing" ? "Testing…" : "Test connection"}
              </Button>
            )}
            {(configs.length > 0 || editing) && (
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
