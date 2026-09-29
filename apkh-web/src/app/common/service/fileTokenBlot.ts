import Quill from "quill";
import type { BlotConstructor, Scope } from "parchment";

type FileTokenValue = {
  id: string;
  name: string;
};

const Embed = Quill.import("blots/embed") as BlotConstructor;

// Visual styling lives in globals.css (.file-token) so it follows the theme.
export class FileTokenBlot extends Embed {
  static blotName = "fileToken";
  static tagName = "span";
  static className = "file-token";
  static scope = Embed.scope as Scope;

  static create(value: FileTokenValue) {
    const node = super.create() as HTMLSpanElement;
    node.setAttribute("data-id", value.id);
    node.setAttribute("data-name", value.name);
    node.innerText = value.name;
    node.contentEditable = "false";

    node.addEventListener("click", () => {
      const customEvent = new CustomEvent("file-token-click", {
        bubbles: true,
        detail: { id: node.getAttribute("data-id"), name: node.getAttribute("data-name") },
      });
      node.dispatchEvent(customEvent);
    });

    return node;
  }
  static value(node: HTMLSpanElement) {
    return {
      id: node.getAttribute("data-id")!,
      name: node.getAttribute("data-name")!,
    };
  }
}

Quill.register(FileTokenBlot as BlotConstructor);
