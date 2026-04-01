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
