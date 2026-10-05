import { getSettings } from "./clip.js";

const $ = (id) => document.getElementById(id);
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "error" : "muted";
};

const settings = await getSettings();
$("apiUrl").value = settings.apiUrl || "http://localhost:3000";
$("token").value = settings.token;

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  let origin;
  try {
    origin = new URL($("apiUrl").value.trim()).origin;
  } catch {
    status("That isn't a valid address.", true);
    return;
  }
  // The extension may only call the server the user allowed.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    status("The clipper needs permission to reach that server.", true);
    return;
  }
  await chrome.storage.local.set({ apiUrl: origin, token: $("token").value.trim() });
  status("Checking…");
  try {
    const response = await fetch(`${origin}/health`);
    if (!response.ok) throw new Error();
    status("Saved. Use the toolbar button, or right-click a page or selection.");
  } catch {
    status(`Saved, but ${origin} didn't answer. Check that the API is running.`, true);
  }
});
