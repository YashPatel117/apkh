import { getSettings, readTab, saveClip } from "./clip.js";

const $ = (id) => document.getElementById(id);
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "muted";
};

async function init() {
  const { apiUrl, token } = await getSettings();
  if (!apiUrl || !token) {
    $("setup").hidden = false;
    $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("form").hidden = false;
  $("title").value = tab?.title ?? "";
  const { category = "" } = await chrome.storage.local.get("category");
  $("category").value = category;

  let clip = null;
  try {
    clip = await readTab(tab.id, "auto");
  } catch {
    status("This page can't be clipped (browser pages and the web store are off limits).", true);
    $("save").disabled = true;
    return;
  }
  const hasSelection = clip?.kind === "selection";
  $("mode-selection").disabled = !hasSelection;
  $(hasSelection ? "mode-selection" : "mode-page").checked = true;

  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("save").disabled = true;
    status("Saving…");
    try {
      const mode = document.querySelector("input[name=mode]:checked").value;
      const content = mode === clip.kind ? clip : await readTab(tab.id, mode);
      if (!content?.html?.trim()) throw new Error("There was nothing to save.");
      await chrome.storage.local.set({ category: $("category").value.trim() });
      await saveClip({ ...content, title: $("title").value.trim() || content.title, category: $("category").value });
      status("Saved. It's being indexed for AI search.");
      setTimeout(() => window.close(), 1200);
    } catch (error) {
      status(error instanceof Error ? error.message : String(error), true);
      $("save").disabled = false;
    }
  });
}

init();
