import { readTab, saveClip } from "./clip.js";

const MENU_SELECTION = "save-selection";
const MENU_PAGE = "save-page";

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({ id: MENU_SELECTION, title: "Save selection to Knowledge Hub", contexts: ["selection"] });
  chrome.contextMenus.create({ id: MENU_PAGE, title: "Save page to Knowledge Hub", contexts: ["page"] });
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon-128.png", title, message });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  try {
    const clip = await readTab(tab.id, info.menuItemId === MENU_SELECTION ? "selection" : "page");
    if (!clip?.html?.trim()) throw new Error("There was nothing to save on this page.");
    const note = await saveClip({ ...clip, title: clip.title || tab.title || "Web clip" });
    notify("Saved to Knowledge Hub", note?.title || clip.title);
  } catch (error) {
    notify("Couldn't save", error instanceof Error ? error.message : String(error));
  }
});
