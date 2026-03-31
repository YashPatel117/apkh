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

    # Extract plain text
    text = soup.get_text(separator="\n", strip=True)
    result.text_content = text

    return result
