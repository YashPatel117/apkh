import { Fragment } from "react";

// Words too common to explain a match
const STOPWORDS = new Set(
  "the a an and or but of to in on at for with from by about as is are was were be been it its this that these those what which who whom whose when where why how do does did have has had my your our their me you we they i not no can could should would will shall may might must any some all more most than then there here into over under again just only also very".split(
    " ",
  ),
);

/** The words of a question that can explain a keyword match (3+ letters, no stopwords). */
export function queryTerms(...texts: (string | undefined)[]): string[] {
  const terms = new Set<string>();
  for (const text of texts) {
    for (const word of (text ?? "").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []) {
      if (word.length >= 3 && !STOPWORDS.has(word)) terms.add(word);
    }
  }
  return [...terms];
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Which of `terms` appear in `text` (as the start of a word). */
export function matchedTerms(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter((term) => new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])${escapeRegExp(term)}`, "u").test(lower));
}

/** `text` with the words starting with one of `terms` marked. */
export function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(${terms.map(escapeRegExp).join("|")})[\\p{L}\\p{M}\\p{N}]*`, "giu");
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(<Fragment key={`t${last}`}>{text.slice(last, at)}</Fragment>);
    parts.push(
      <mark key={`m${at}`} className="rounded-sm bg-amber-100 px-0.5 text-inherit dark:bg-amber-400/20">
        {match[0]}
      </mark>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}
