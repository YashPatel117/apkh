import striptags from 'striptags';

type ResolveNoteMetadataInput = {
  title?: string | null;
  category?: string | null;
  content?: string | null;
  existingCategories?: string[];
};

type ResolvedNoteMetadata = {
  title: string;
  category: string;
};

const FALLBACK_TITLE = 'Untitled Note';
const FALLBACK_CATEGORY = 'General';
const ACRONYMS = new Set(['ai', 'api', 'db', 'ml', 'qa', 'seo', 'sql', 'ui', 'ux']);
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'has',
  'have',
  'how',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'them',
  'this',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'your',
]);

const CATEGORY_HINTS = [
  {
    label: 'Development',
    keywords: [
      'api',
      'backend',
      'bug',
      'code',
      'coding',
      'database',
      'debug',
      'deployment',
      'docker',
      'endpoint',
      'feature',
      'frontend',
      'git',
      'javascript',
      'nest',
      'nextjs',
      'node',
      'python',
      'react',
      'schema',
      'server',
      'sql',
      'typescript',
    ],
  },
  {
    label: 'Meetings',
    keywords: [
      'agenda',
      'attendee',
      'discussion',
      'followup',
      'meeting',
      'minutes',
      'recap',
      'retrospective',
      'standup',
      'sync',
    ],
  },
  {
    label: 'Tasks',
    keywords: [
      'action',
      'checklist',
      'deadline',
      'deliverable',
      'milestone',
      'nextstep',
      'task',
      'todo',
    ],
  },
  {
    label: 'Research',
    keywords: [
      'analysis',
      'benchmark',
      'comparison',
      'experiment',
      'finding',
      'hypothesis',
      'investigation',
      'research',
      'study',
    ],
  },
  {
    label: 'Documentation',
    keywords: [
      'architecture',
      'documentation',
      'docs',
      'guide',
      'reference',
      'spec',
      'specification',
    ],
  },
  {
    label: 'Learning',
    keywords: [
      'chapter',
      'course',
      'learn',
      'learning',
      'lesson',
      'revision',
      'study',
      'tutorial',
    ],
  },
  {
    label: 'Design',
    keywords: [
      'brand',
      'design',
      'layout',
      'mockup',
      'prototype',
      'ui',
      'ux',
      'visual',
      'wireframe',
    ],
  },
  {
    label: 'Finance',
    keywords: [
      'budget',
      'cost',
      'expense',
      'finance',
      'invoice',
      'pricing',
      'revenue',
    ],
  },
  {
    label: 'Project Planning',
    keywords: [
      'feature',
      'plan',
      'planning',
      'prioritization',
      'project',
      'release',
      'roadmap',
      'sprint',
    ],
  },
];

export function resolveNoteMetadata({
  title,
  category,
  content,
  existingCategories = [],
}: ResolveNoteMetadataInput): ResolvedNoteMetadata {
  const plainText = toPlainText(content);
  const sourceText = normalizeWhitespace([title, plainText].filter(Boolean).join(' '));
  const resolvedTitle = normalizeUserText(title) || generateTitle(plainText);
  const categorySource = sourceText || (resolvedTitle === FALLBACK_TITLE ? '' : resolvedTitle);
  const resolvedCategory =
    resolveProvidedCategory(category, existingCategories) ||
    findBestExistingCategory(existingCategories, categorySource) ||
    inferHintCategory(categorySource) ||
    inferKeywordCategory(categorySource);

  return {
    title: resolvedTitle,
    category: resolvedCategory,
  };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeUserText(value?: string | null): string {
  if (!value) {
    return '';
  }

  return normalizeWhitespace(value);
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function toPlainText(content?: string | null): string {
  if (!content) {
    return '';
  }

  const contentWithLineBreaks = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(article|blockquote|div|h[1-6]|li|ol|p|section|ul)>/gi, '\n');

  return decodeBasicEntities(striptags(contentWithLineBreaks).replace(/\u00a0/g, ' '))
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join('\n');
}

function generateTitle(plainText: string): string {
  const firstLine = firstMeaningfulLine(plainText);
  if (firstLine) {
    const firstSentence = normalizeWhitespace(firstLine.split(/[.!?](?:\s|$)/)[0] || firstLine);
    return trimToLength(firstSentence || firstLine, 72) || FALLBACK_TITLE;
  }

  const tokens = extractTokens(plainText).slice(0, 5);
  if (tokens.length) {
    return trimToLength(tokens.map(formatTokenLabel).join(' '), 72);
  }

  return FALLBACK_TITLE;
}

function firstMeaningfulLine(plainText: string): string {
  const lines = plainText
    .split(/\n+/)
    .map((line) =>
      normalizeWhitespace(line.replace(/^#+\s*/, '').replace(/^[\s\-*\u2022\d.)]+/, '')),
    )
    .filter(Boolean);

  return lines.find((line) => line.length >= 3) ?? '';
}

function trimToLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const sliced = value.slice(0, maxLength + 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const cutoff = lastSpace > maxLength * 0.5 ? lastSpace : maxLength;
  return `${sliced.slice(0, cutoff).trim()}...`;
}

function resolveProvidedCategory(
  category: string | null | undefined,
  existingCategories: string[],
): string | null {
  const normalizedCategory = normalizeUserText(category);
  if (!normalizedCategory) {
    return null;
  }

  const matchingExistingCategory = existingCategories.find(
    (existingCategory) =>
      existingCategory.trim().toLowerCase() === normalizedCategory.toLowerCase(),
  );

  return matchingExistingCategory?.trim() || normalizedCategory;
}

function findBestExistingCategory(
  existingCategories: string[],
  sourceText: string,
): string | null {
  if (!sourceText) {
    return null;
  }

  const sourceTokens = new Set(extractTokens(sourceText));
  const normalizedSource = sourceText.toLowerCase();

  let bestCategory: string | null = null;
  let bestScore = 0;

  for (const existingCategory of existingCategories) {
    const score = scoreExistingCategory(
      existingCategory,
      normalizedSource,
      sourceTokens,
    );

    if (score > bestScore) {
      bestScore = score;
      bestCategory = existingCategory.trim();
    }
  }

  return bestScore >= 5 ? bestCategory : null;
}

function scoreExistingCategory(
  category: string,
  normalizedSource: string,
  sourceTokens: Set<string>,
): number {
  const trimmedCategory = category.trim();
  if (!trimmedCategory) {
    return 0;
  }

  let score = 0;
  if (normalizedSource.includes(trimmedCategory.toLowerCase())) {
    score += 6 + Math.min(trimmedCategory.length / 10, 3);
  }

  const categoryTokens = extractTokens(trimmedCategory);
  if (!categoryTokens.length) {
    return score;
  }

  const matchedTokens = categoryTokens.filter((token) => sourceTokens.has(token)).length;
  if (!matchedTokens) {
    return score;
  }

  const coverage = matchedTokens / categoryTokens.length;
  score += matchedTokens * 2;

  if (coverage === 1) {
    score += 4;
  }

  return score;
}

function inferHintCategory(sourceText: string): string | null {
  const sourceTokens = new Set(extractTokens(sourceText));

  let bestLabel: string | null = null;
  let bestScore = 0;

  for (const hint of CATEGORY_HINTS) {
    const score = hint.keywords.reduce(
      (total, keyword) => total + (sourceTokens.has(normalizeToken(keyword)) ? 1 : 0),
      0,
    );

    if (score > bestScore) {
      bestScore = score;
      bestLabel = hint.label;
    }
  }

  return bestScore > 0 ? bestLabel : null;
}

function inferKeywordCategory(sourceText: string): string {
  const tokens = extractTokens(sourceText);
  if (!tokens.length) {
    return FALLBACK_CATEGORY;
  }

  const frequency = new Map<string, { count: number; firstIndex: number }>();
  tokens.forEach((token, index) => {
    const current = frequency.get(token);
    if (current) {
      current.count += 1;
      return;
    }

    frequency.set(token, { count: 1, firstIndex: index });
  });

  const selectedTokens = [...frequency.entries()]
    .sort((a, b) => {
      if (b[1].count !== a[1].count) {
        return b[1].count - a[1].count;
      }

      return a[1].firstIndex - b[1].firstIndex;
    })
    .map(([token]) => token)
    .slice(0, 2);

  return selectedTokens.length
    ? selectedTokens.map(formatTokenLabel).join(' ')
    : FALLBACK_CATEGORY;
}

function extractTokens(value: string): string[] {
  const matches = value.match(/[A-Za-z0-9+#.-]+/g) ?? [];

  return matches
    .map((token) => normalizeToken(token))
    .filter(
      (token) =>
        Boolean(token) &&
        (token.length > 2 || ACRONYMS.has(token)) &&
        !STOP_WORDS.has(token),
    );
}

function normalizeToken(value: string): string {
  let normalized = value.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

  if (!normalized) {
    return '';
  }

  if (normalized.length > 4 && normalized.endsWith('ies')) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (normalized.length > 5 && normalized.endsWith('ing')) {
    normalized = normalized.slice(0, -3);
  } else if (normalized.length > 4 && normalized.endsWith('ed')) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.length > 4 && normalized.endsWith('es')) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.length > 3 && normalized.endsWith('s')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function formatTokenLabel(token: string): string {
  return ACRONYMS.has(token)
    ? token.toUpperCase()
    : `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
}
