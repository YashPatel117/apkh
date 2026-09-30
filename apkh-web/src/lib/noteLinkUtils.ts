const SPECIAL_OR_ABSOLUTE_LINK_PATTERN =
  /^(?:https?:|mailto:|tel:|ftp:|ftps:|sms:|news:|irc:|ircs:|data:|blob:|\/\/|\/|\.\/|\.\.\/|#|\?)/i;

const EMAIL_LINK_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const HOSTNAME_LINK_PATTERN =
  /^(?:localhost(?::\d+)?|(?:[\w-]+\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:[/?#].*)?$/i;

const NOTE_LINK_HREF_PATTERN = /(<a\b[^>]*?\bhref=(['"]))(.*?)(\2)/gi;

export function normalizeNoteLinkHref(href: string) {
  const trimmedHref = href.trim();

  if (!trimmedHref || SPECIAL_OR_ABSOLUTE_LINK_PATTERN.test(trimmedHref)) {
    return trimmedHref;
  }

  if (EMAIL_LINK_PATTERN.test(trimmedHref)) {
    return `mailto:${trimmedHref}`;
  }

  if (HOSTNAME_LINK_PATTERN.test(trimmedHref)) {
    return `https://${trimmedHref}`;
  }

  return trimmedHref;
}

/**
 * Notes saved by the old editor gave every `.file-token` inline colours
 * (`background-color:#e0f7fa; color:#00796b; …`). Quill reads those as
 * background/colour formats and wraps the chip in a coloured <span>, which shows
 * up as a pale box around it. This strips the inline styles and unwraps such
 * spans so the chip is styled only by `.file-token` in globals.css.
 */
export function stripLegacyFileTokenStyles(content: string) {
  if (!content || !content.includes("file-token") || typeof DOMParser === "undefined") return content;

  const doc = new DOMParser().parseFromString(`<body>${content}</body>`, "text/html");
  doc.body.querySelectorAll<HTMLElement>(".file-token").forEach((token) => {
    token.removeAttribute("style");
    // The toolbar has no colour tools, so a styled span wrapping only a chip is legacy.
    let wrapper = token.parentElement;
    while (
      wrapper &&
      wrapper !== doc.body &&
      wrapper.tagName === "SPAN" &&
      !wrapper.classList.contains("file-token") &&
      wrapper.childNodes.length === 1
    ) {
      const next = wrapper.parentElement;
      wrapper.replaceWith(token);
      wrapper = next;
    }
  });
  return doc.body.innerHTML;
}

export function normalizeNoteLinksInHtml(content: string) {
  if (!content) return content;

  return content.replace(
    NOTE_LINK_HREF_PATTERN,
    (match, prefix: string, quote: string, href: string) => {
      const normalizedHref = normalizeNoteLinkHref(href);

      if (normalizedHref === href) {
        return match;
      }

      return `${prefix}${normalizedHref}${quote}`;
    }
  );
}
