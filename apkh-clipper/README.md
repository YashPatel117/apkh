# Knowledge Hub Clipper

A Chrome/Edge (Manifest V3) extension that saves the page you're reading, or the
text you selected, as a note through `POST /integrations/notes`.

## Install (unpacked)

1. In Knowledge Hub, open **Profile → Integrations** and create a token named "Web clipper".
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick this folder.
3. The options page opens: paste the API address (e.g. `http://localhost:3000`) and the token, then **Save and test**.
   The extension asks for permission to reach that server only.

## Use

- Toolbar button: edit the title and category, choose **Selection** or **Whole page**, **Save note**.
- Right-click a page or a selection: **Save … to Knowledge Hub** (a notification confirms it).

Clips go in the "Web clips" category unless you choose another, end with a link to the source,
and are indexed for AI search like any other note. The server sanitizes the HTML.
