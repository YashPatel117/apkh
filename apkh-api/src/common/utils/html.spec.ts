import { htmlToPlainText } from './html';

describe('htmlToPlainText', () => {
  it('keeps paragraphs and list items on separate lines', () => {
    expect(
      htmlToPlainText(
        '<p>Hello</p><p>World</p><ul><li>one</li><li>two</li></ul>',
      ),
    ).toBe('Hello\nWorld\none\ntwo');
  });

  it('decodes entities once and turns <br> into line breaks', () => {
    expect(
      htmlToPlainText('<p>Tom &amp; Jerry<br>&amp;lt;tag&amp;gt;&nbsp;x</p>'),
    ).toBe('Tom & Jerry\n&lt;tag&gt; x');
  });

  it('returns an empty string for empty notes', () => {
    expect(htmlToPlainText('<p><br></p>')).toBe('');
    expect(htmlToPlainText(undefined)).toBe('');
  });
});
