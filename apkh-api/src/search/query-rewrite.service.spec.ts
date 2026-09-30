import { isWeakResult, looksLikeFollowUp } from './query-rewrite.service';
import { mergeRankings, RetrievedChunk } from './retrieval.service';

const chunk = (
  id: string,
  extra: Partial<RetrievedChunk> = {},
): RetrievedChunk => ({
  id,
  noteTitle: 'N',
  sourceType: 'note',
  text: id,
  similarity: null,
  keywordMatch: false,
  score: 0,
  ...extra,
});

describe('looksLikeFollowUp', () => {
  it.each([
    ['and the budget for it?', true],
    ['what about those?', true],
    ['tell me more', true],
    ['What did the team decide about the database migration plan?', false],
    ['Summarize the security review findings from the audit notes', false],
  ])('%s -> %s', (message, expected) => {
    expect(looksLikeFollowUp(message)).toBe(expected);
  });
});

describe('isWeakResult', () => {
  it('is weak with no results', () => {
    expect(isWeakResult([], true, 0.7)).toBe(true);
    expect(isWeakResult([], false, 0.7)).toBe(true);
  });

  it('is strong with a keyword match or a close semantic match', () => {
    expect(
      isWeakResult(
        [chunk('a', { keywordMatch: true, similarity: 0.4 })],
        true,
        0.7,
      ),
    ).toBe(false);
    expect(isWeakResult([chunk('a', { similarity: 0.75 })], true, 0.7)).toBe(
      false,
    );
  });

  it('is weak when only distant semantic matches were found', () => {
    expect(isWeakResult([chunk('a', { similarity: 0.55 })], true, 0.7)).toBe(
      true,
    );
  });
});

describe('mergeRankings', () => {
  it('ranks passages found by both searches first and keeps the best evidence', () => {
    const first = [
      chunk('a', { similarity: 0.6 }),
      chunk('b', { similarity: 0.55 }),
    ];
    const second = [
      chunk('c', { keywordMatch: true }),
      chunk('b', { similarity: 0.72, keywordMatch: true }),
    ];
    const merged = mergeRankings([first, second], 3);
    expect(merged.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(merged[0]).toMatchObject({ similarity: 0.72, keywordMatch: true });
  });

  it('respects the limit', () => {
    expect(
      mergeRankings([[chunk('a'), chunk('b'), chunk('c')]], 2),
    ).toHaveLength(2);
  });
});
