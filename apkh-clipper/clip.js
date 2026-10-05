// Shared by the popup and the background worker.

const MAX_CONTENT = 1_900_000; // the API accepts up to 2,000,000 characters

/** The server address and token from the options page. */
export async function getSettings() {
  const { apiUrl = "", token = "" } = await chrome.storage.local.get(["apiUrl", "token"]);
  return { apiUrl: apiUrl.replace(/\/+$/, ""), token };
}

/**
 * Runs in the page: the selection as HTML, or (whole page) the main article
 * without scripts, navigation and other chrome.
 */
function readPage(mode) {
  const selection = window.getSelection();
  if (mode === "selection" || (mode === "auto" && selection && !selection.isCollapsed)) {
    if (selection && !selection.isCollapsed) {
      const box = document.createElement("div");
      for (let i = 0; i < selection.rangeCount; i++) box.appendChild(selection.getRangeAt(i).cloneContents());
      return { kind: "selection", title: document.title, url: location.href, html: box.innerHTML };
    }
    if (mode === "selection") return { kind: "selection", title: document.title, url: location.href, html: "" };
  }
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  const copy = root.cloneNode(true);
  copy.querySelectorAll("script, style, noscript, iframe, nav, header, footer, aside, form, button, svg, [aria-hidden='true']").forEach((el) => el.remove());
  // Make links and images absolute so they still work in the note.
  copy.querySelectorAll("a[href]").forEach((a) => a.setAttribute("href", a.href));
  copy.querySelectorAll("img[src]").forEach((img) => img.setAttribute("src", img.src));
  return { kind: "page", title: document.title, url: location.href, html: copy.innerHTML };
}

/** Reads the selection or the page in `tabId`. */
export async function readTab(tabId, mode = "auto") {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage, args: [mode] });
  return result?.result;
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Sends a clip to the Knowledge Hub API; resolves with the new note's { id, title }. */
export async function saveClip({ title, url, html, category }) {
  const { apiUrl, token } = await getSettings();
  if (!apiUrl || !token) throw new Error("Set the server address and token in the extension's options first.");
  const source = `<p><em>Clipped from <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></em></p>`;
  const content = (html.length > MAX_CONTENT ? html.slice(0, MAX_CONTENT) : html) + source;
  let response;
  try {
    response = await fetch(`${apiUrl}/integrations/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: title.slice(0, 300), content, format: "html", url, category: category?.trim() || "Web clips" }),
    });
  } catch {
    throw new Error(`Can't reach ${apiUrl}. Check the address in the options and that the server is running.`);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(data?.message) ? data.message[0] : data?.message;
    throw new Error(response.status === 401 ? "The token was refused. Create a new one in Profile → Integrations." : message || `The server answered ${response.status}.`);
  }
  return data;
}
