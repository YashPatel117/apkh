import Quill from "quill";

type FileTokenValue = {
  id: string;
  name: string;
};

type EmbedBlotConstructor = {
  new (...args: never[]): unknown;
  create(value?: unknown): HTMLElement;
  scope: unknown;
};

const Embed = Quill.import("blots/embed") as EmbedBlotConstructor;

export class FileTokenBlot extends Embed {
  static blotName = "fileToken";
  static tagName = "span";
  static className = "file-token";
  static scope = Embed.scope;

  static create(value: FileTokenValue) {
    const node = super.create() as HTMLSpanElement;
    node.setAttribute("data-id", value.id);
    node.setAttribute("data-name", value.name);
    node.innerText = value.name;
    node.contentEditable = "false";
    node.style.backgroundColor = "#e0f7fa";
    node.style.padding = "2px 6px";
    node.style.borderRadius = "4px";
    node.style.cursor = "pointer";
    node.style.color = "#00796b";

    node.addEventListener("click", () => {
      const fileName = node.getAttribute("data-name");
      const fileId = node.getAttribute("data-id");
      const customEvent = new CustomEvent("file-token-click", {
        bubbles: true,
        detail: { id: fileId, name: fileName },
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

Quill.register(FileTokenBlot);
