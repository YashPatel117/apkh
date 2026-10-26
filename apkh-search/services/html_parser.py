"""
HTML Parser for Quill.js rich text content.
Extracts plain text, links, and file tokens from note HTML.
"""

from bs4 import BeautifulSoup
from dataclasses import dataclass, field


@dataclass
class ParsedNote:
    text_content: str = ""
    links: list[dict] = field(default_factory=list)
    file_tokens: list[dict] = field(default_factory=list)


def parse_note_html(html: str) -> ParsedNote:
    """
    Parse Quill HTML content and extract:
    - Plain text (stripped of HTML tags)
    - Links (href + anchor text)
    - File tokens (data-id and data-name from .file-token spans)
    """
    if not html or not html.strip():
        return ParsedNote()

    soup = BeautifulSoup(html, "html.parser")
    result = ParsedNote()

    # Extract file tokens BEFORE stripping (they are spans with class="file-token")
    file_token_spans = soup.find_all("span", class_="file-token")
    for span in file_token_spans:
        file_id = span.get("data-id", "")
        file_name = span.get("data-name", "")
        if file_name:
            result.file_tokens.append({
                "id": file_id,
                "name": file_name
            })
        # Remove the span so it doesn't appear in plain text
        span.decompose()

    # Extract links
    link_tags = soup.find_all("a")
    for a in link_tags:
        href = a.get("href", "")
        text = a.get_text(strip=True)
        if href:
            result.links.append({
                "href": href,
                "text": text
            })

    result.text_content = _plain_text(soup)
    return result


# Elements that start a new line; inline ones (links, bold…) stay in their sentence.
_BLOCK_TAGS = [
    "p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "pre", "tr", "td", "th", "ul", "ol", "table",
]


def _plain_text(soup: BeautifulSoup) -> str:
    """One line per paragraph, list item or heading, with whitespace collapsed."""
    for br in soup.find_all("br"):
        br.replace_with("\n")
    for tag in soup.find_all(_BLOCK_TAGS):
        tag.append("\n")
    lines = (" ".join(line.split()) for line in soup.get_text().splitlines())
    return "\n".join(line for line in lines if line)
