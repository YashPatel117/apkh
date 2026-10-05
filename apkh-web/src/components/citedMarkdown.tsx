"use client";

import ReactMarkdown from "react-markdown";
import { useT } from "@/i18n";

// [n] not followed by "(" — that would be a markdown link
const CITATION = /\[(\d+)\](?!\()/g;
const CITE_HREF = /^#cite-(\d+)$/;

/**
 * Markdown whose [n] citations become small buttons that open source n.
 * Numbers without a matching source are left as plain text.
 */
export function CitedMarkdown({
  text,
  sourceCount,
  onCite,
}: {
  text: string;
  sourceCount: number;
  onCite: (sourceNumber: number) => void;
}) {
  const t = useT();
  const linked = text.replace(CITATION, (match, n: string) =>
    Number(n) >= 1 && Number(n) <= sourceCount ? `[${n}](#cite-${n})` : match,
  );

  return (
    <ReactMarkdown
      components={{
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- keep `node` off the DOM
        a: ({ node, href, children, ...props }) => {
          const cite = href?.match(CITE_HREF);
          if (cite) {
            return (
              <button
                type="button"
                onClick={() => onCite(Number(cite[1]))}
                className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] cursor-pointer items-center justify-center rounded-md bg-accent-soft px-1 align-text-top text-[0.68rem] font-bold text-accent-fg no-underline transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-400/20"
                aria-label={t("common.openSource", { n: cite[1] })}
              >
                {cite[1]}
              </button>
            );
          }
          return (
            <a href={href} target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          );
        },
      }}
    >
      {linked}
    </ReactMarkdown>
  );
}
