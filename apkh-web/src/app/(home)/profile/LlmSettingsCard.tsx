"use client";

import { useState } from "react";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RadioButtonCheckedIcon from "@mui/icons-material/RadioButtonChecked";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import TokenOutlinedIcon from "@mui/icons-material/TokenOutlined";
import {
  testLlmSettings,
  addLlmConfig,
  activateLlmConfig,
  deleteLlmConfig,
} from "@/service/authService";
import { useAppDispatch } from "@/store/hook";
import { setUser } from "@/store/slices/authSlice";
import { ILlmConfig, IUser } from "@/app/common/models/user";
// ── Provider catalogue ───────────────────────────────────────────────────────
const PROVIDER_GROUPS = [
  {
    label: "Google Gemini",
    prefix: "gemini",
    docsUrl: "https://aistudio.google.com/app/apikey",
    models: [
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ],
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
    models: [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
    ],
  },
];

function detectProvider(model: string) {
  return (
    PROVIDER_GROUPS.find((g) => model.toLowerCase().startsWith(g.prefix)) ??
    null
  );
}

type TestStatus = "idle" | "testing" | "ok" | "error";

interface Props {
  user: IUser;
}

// ── Saved config row ─────────────────────────────────────────────────────────
function ConfigRow({
  config,
  onActivate,
  onDelete,
}: {
  config: ILlmConfig;
  onActivate: (keyName: string) => Promise<void>;
  onDelete: (keyName: string) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const provider = detectProvider(config.llmModel);

  async function handleActivate() {
    if (config.isActive) return;
    setLoading(true);
    await onActivate(config.keyName);
    setLoading(false);
  }

  async function handleDelete() {
    setDeleting(true);
    await onDelete(config.keyName);
    setDeleting(false);
  }

  return (
    <div
      className={`flex items-center gap-3 rounded-[18px] border px-4 py-3 transition-all ${
        config.isActive
          ? "border-sky-200 bg-sky-50 ring-1 ring-sky-200"
          : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      {/* Active radio */}
      <Tooltip title={config.isActive ? "Active" : "Set as active"}>
        <span>
          <IconButton
            size="small"
            onClick={handleActivate}
            disabled={config.isActive || loading}
            className={config.isActive ? "text-sky-600!" : "text-slate-400!"}
          >
            {loading ? (
              <CircularProgress size={16} />
            ) : config.isActive ? (
              <RadioButtonCheckedIcon sx={{ fontSize: 18 }} />
            ) : (
              <RadioButtonUncheckedIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </span>
      </Tooltip>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-slate-900">
            {config.keyName}
          </p>
          {config.isActive && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-700">
              Active
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {config.llmModel}
          {provider && (
            <span className="ml-1.5 text-slate-400">· {provider.label}</span>
          )}
        </p>
      </div>

      {/* Per-config token badge */}
      <div className="flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-100">
        <TokenOutlinedIcon sx={{ fontSize: 12 }} />
        {config.tokensUsed.toLocaleString()}
      </div>

      {/* Delete */}
      <Tooltip title="Remove this config">
        <span>
          <IconButton
            size="small"
            onClick={handleDelete}
            disabled={deleting}
            className="text-slate-400! hover:text-red-500!"
          >
            {deleting ? (
              <CircularProgress size={14} />
            ) : (
              <DeleteOutlineIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </span>
      </Tooltip>
    </div>
  );
}

// ── Main card ────────────────────────────────────────────────────────────────
export default function LlmSettingsCard({ user }: Props) {
  const dispatch = useAppDispatch();
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [keyName, setKeyName] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [customModel, setCustomModel] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const activeModel = useCustom ? customModel : model;
  const provider = detectProvider(activeModel);
  const canTest =
    keyName.trim().length > 0 &&
    activeModel.trim().length > 0 &&
    apiKey.trim().length > 0;
  const canSave = testStatus === "ok" && canTest && !saving;

  const configs: ILlmConfig[] = user.llmConfigs ?? [];
  const activeConfig = configs.find((c) => c.isActive);

  function resetForm() {
    setKeyName("");
    setModel("gemini-2.5-flash");
    setCustomModel("");
    setUseCustom(false);
    setApiKey("");
    setTestStatus("idle");
    setTestError(null);
    setSavedOk(false);
    setShowForm(false);
  }

  async function handleTest() {
    setTestStatus("testing");
    setTestError(null);
    try {
      const result = await testLlmSettings({ apiKey, model: activeModel });
      setTestStatus(result.ok ? "ok" : "error");
      if (!result.ok) setTestError(result.error ?? "Connection failed.");
    } catch {
      setTestStatus("error");
      setTestError("Could not reach the server.");
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updatedUser = await addLlmConfig({
        keyName: keyName.trim(),
        apiKey,
        model: activeModel,
        setActive: true,
      });
      setSavedOk(true);
      dispatch(setUser({ ...user, ...updatedUser }));
      setTimeout(resetForm, 1200);
    } catch {
      setTestError("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(name: string) {
    const updatedUser = await activateLlmConfig(name);
    dispatch(setUser({ ...user, ...updatedUser }));
  }

  async function handleDelete(name: string) {
    const updatedUser = await deleteLlmConfig(name);
    dispatch(setUser({ ...user, ...updatedUser }));
  }

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sky-700">
          <SmartToyOutlinedIcon sx={{ fontSize: 18 }} />
          <span className="text-xs font-semibold uppercase tracking-[0.22em]">
            AI Model Settings
          </span>
        </div>
        <Button
          size="small"
          variant={showForm ? "outlined" : "contained"}
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="rounded-full! normal-case! text-xs!"
          startIcon={
            showForm ? undefined : (
              <AddCircleOutlineIcon sx={{ fontSize: 15 }} />
            )
          }
        >
          {showForm ? "Cancel" : "Add Config"}
        </Button>
      </div>

      {/* Active config summary */}
      {activeConfig && !showForm && (
        <div className="mt-3 rounded-[16px] bg-sky-50 px-4 py-2.5 ring-1 ring-sky-100">
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-600">
            Active
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">
            {activeConfig.keyName}
          </p>
          <p className="text-xs text-slate-500">{activeConfig.llmModel}</p>
        </div>
      )}

      {/* Config list */}
      {configs.length > 0 && !showForm && (
        <div className="mt-4 space-y-2">
          {configs.map((cfg) => (
            <ConfigRow
              key={cfg.keyName}
              config={cfg}
              onActivate={handleActivate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {configs.length === 0 && !showForm && (
        <p className="mt-4 text-center text-sm text-slate-400">
          No configs yet. Add one to enable AI search.
        </p>
      )}

      {/* Add new config form */}
      {showForm && (
        <div className="mt-4 space-y-3">
          <TextField
            label="Config Name"
            placeholder='e.g. "My GPT-4o Key", "Work Gemini"'
            value={keyName}
            onChange={(e) => {
              setKeyName(e.target.value);
              setTestStatus("idle");
            }}
            size="small"
            fullWidth
            sx={{ "& .MuiOutlinedInput-root": { borderRadius: "16px" } }}
          />

          {/* Provider tabs */}
          <div className="flex flex-wrap gap-2 py-2">
            {PROVIDER_GROUPS.map((pg) => (
              <button
                key={pg.prefix}
                onClick={() => {
                  setUseCustom(false);
                  setModel(pg.models[0]);
                  setTestStatus("idle");
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                  !useCustom && detectProvider(model)?.prefix === pg.prefix
                    ? "bg-sky-600 text-white shadow"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {pg.label}
              </button>
            ))}
            <button
              onClick={() => {
                setUseCustom(true);
                setTestStatus("idle");
              }}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                useCustom
                  ? "bg-sky-600 text-white shadow"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Custom
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {useCustom ? (
              <TextField
                label="Model identifier"
                placeholder="e.g. gpt-4o, claude-3-5-sonnet-20241022"
                value={customModel}
                onChange={(e) => {
                  setCustomModel(e.target.value);
                  setTestStatus("idle");
                }}
                size="small"
                fullWidth
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: "16px" } }}
              />
            ) : (
              <TextField
                select
                label="Model"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setTestStatus("idle");
                }}
                size="small"
                fullWidth
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: "16px" } }}
              >
                {(provider?.models ?? PROVIDER_GROUPS[0].models).map((m) => (
                  <MenuItem key={m} value={m}>
                    {m}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <TextField
              label="API Key"
              type="password"
              placeholder="Paste your API key"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestStatus("idle");
                setSavedOk(false);
              }}
              size="small"
              fullWidth
              helperText={
                provider ? (
                  <a
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-600 underline"
                  >
                    Get your {provider.label} API key →
                  </a>
                ) : undefined
              }
              sx={{
                "& .MuiOutlinedInput-root": { borderRadius: "16px" },
                "& .MuiFormHelperText-root": {
                  marginLeft: 0,
                  marginTop: "6px",
                },
              }}
            />

            {testStatus === "ok" && (
              <div className="flex items-center gap-2 rounded-[14px] bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200">
                <CheckCircleOutlineIcon sx={{ fontSize: 16 }} /> Connection
                successful! You can now save.
              </div>
            )}
            {testStatus === "error" && (
              <div className="flex items-start gap-2 rounded-[14px] bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
                <ErrorOutlineIcon
                  sx={{ fontSize: 16 }}
                  className="mt-0.5 shrink-0"
                />
                <span className="break-all">{testError}</span>
              </div>
            )}
            {savedOk && (
              <div className="flex items-center gap-2 rounded-[14px] bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200">
                <CheckCircleOutlineIcon sx={{ fontSize: 16 }} /> Config saved
                and set as active!
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outlined"
              size="small"
              disabled={!canTest || testStatus === "testing"}
              onClick={handleTest}
              className="rounded-[14px]! normal-case!"
              startIcon={
                testStatus === "testing" ? (
                  <CircularProgress size={14} />
                ) : undefined
              }
            >
              {testStatus === "testing" ? "Testing…" : "Test Connection"}
            </Button>
            <Button
              variant="contained"
              size="small"
              disabled={!canSave}
              onClick={handleSave}
              className="rounded-[14px]! normal-case!"
              startIcon={
                saving ? (
                  <CircularProgress size={14} color="inherit" />
                ) : undefined
              }
            >
              {saving ? "Saving…" : "Save Config"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
