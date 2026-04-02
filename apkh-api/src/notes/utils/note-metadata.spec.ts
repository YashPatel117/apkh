import { resolveNoteMetadata } from './note-metadata';

describe('resolveNoteMetadata', () => {
  it('preserves user-provided metadata and reuses existing category casing', () => {
    const metadata = resolveNoteMetadata({
      title: '  Sprint retrospective  ',
      category: ' meetings ',
      content: '<p>Team retro notes</p>',
      existingCategories: ['Meetings', 'Development'],
    });

    expect(metadata).toEqual({
      title: 'Sprint retrospective',
      category: 'Meetings',
    });
  });

  it('generates a title and reuses a related existing category when missing', () => {
    const metadata = resolveNoteMetadata({
      content:
        '<p>Angular standalone components migration</p><p>Move shared modules into feature-level imports.</p>',
      existingCategories: ['Angular', 'Personal'],
    });

    expect(metadata).toEqual({
      title: 'Angular standalone components migration',
      category: 'Angular',
    });
  });

  it('creates a new inferred category when no related category exists', () => {
    const metadata = resolveNoteMetadata({
      content:
        '<p>React API auth flow</p><p>Implement JWT refresh token rotation and secure session handling.</p>',
      existingCategories: ['Personal'],
    });

    expect(metadata).toEqual({
      title: 'React API auth flow',
      category: 'Development',
    });
  });

  it('falls back safely when the note has no useful text', () => {
    const metadata = resolveNoteMetadata({
      content: '<p><br></p>',
      existingCategories: [],
    });

    expect(metadata).toEqual({
      title: 'Untitled Note',
      category: 'General',
    });
  });
});
