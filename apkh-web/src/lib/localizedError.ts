import type { MessageKey, Translate } from "@/i18n";
import { getErrorMessage } from "@/services/axios";

type Vars = Record<string, string | number>;

/**
 * An error thrown outside React (no `t` there): the message is English, and
 * `messageKey` lets the component that shows it use the app's language.
 */
export function localized(message: string, messageKey: MessageKey, vars?: Vars) {
  return Object.assign(new Error(message), { messageKey, vars });
}

/** What to show for a caught error, in the app's language when it can be. */
export function errorText(t: Translate, error: unknown, fallback: MessageKey) {
  const { messageKey, vars } = (error ?? {}) as { messageKey?: MessageKey; vars?: Vars };
  return messageKey ? t(messageKey, vars) : getErrorMessage(error, t(fallback));
}
