<div align="center">
  <img src="icons/icon-128.png" width="96" height="96" alt="WhatsApp Full Chat Screenshot icon" />
  <h1>Full Chat Screenshot for WhatsApp Web</h1>
  <p><strong>Capture an entire WhatsApp Web conversation as one stitched PNG — from the first message, or from any message you pick.</strong></p>
  <p>No manual scrolling. No gaps. 100% local. Nothing leaves your browser.</p>
</div>

---

## Why

WhatsApp Web uses a **virtualized** message list: only the messages currently on
screen exist in the page. So "Save page as image" or a single screenshot can't
give you the whole thread, and manual screenshot-and-scroll leaves overlaps and
gaps.

This extension scrolls the conversation for you and stitches the result into a
pixel-accurate image of WhatsApp itself — bubbles, wallpaper, timestamps and all.

## Features

- **Full conversation in one click** — from the very first message to the latest.
- **Start from any message** — pick the message to start from; the image runs
  from just above it to the end of the conversation.
- **Auto load-older** — scrolls to the top until WhatsApp stops loading earlier
  messages, so nothing is missed.
- **Seamless stitching** — each scroll step appends only the *newly revealed*
  strip (strip height = scroll delta), so there's no overlap and no gap.
- **Auto-split** — conversations taller than the browser's canvas limit are saved
  as numbered parts (`...-part01.png`, `...-part02.png`, …).
- **High-DPI correct** — scaling is derived from the actual captured bitmap, so
  it's sharp on Retina / fractional-scaling displays.
- **Live progress + Cancel** — an on-page box shows frame count and percentage;
  it's hidden during each capture so it's never baked into the image.
- **Clean captures** — a transparent layer blocks the mouse while capturing, so
  WhatsApp's hover buttons never end up in the image.
- **Private** — no servers, analytics, tracking, or network requests of any kind.

## Screenshots

| | |
| --- | --- |
| ![Hero](store/screenshot-1-hero.png) | ![Result](store/screenshot-2-result.png) |
| ![Privacy](store/screenshot-3-privacy.png) | ![How it works](store/screenshot-4-how.png) |

## Install (unpacked / developer mode)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. (Optional) pin the extension to the toolbar.

> Works in Chrome and Chromium-based browsers (Edge, Brave, Arc) on
> manifest-v3-capable versions (Chrome 109+).

## Usage

1. Open <https://web.whatsapp.com> and log in.
2. Open the conversation you want to capture.
3. Click the extension icon → **Capture full conversation**.
4. Watch the progress box (bottom-right of the page). When it finishes, the
   PNG(s) are in your **Downloads** folder, named `whatsapp-<chat>.png`.

To start from a specific message instead, choose **Capture from a message…** in
step 3. Scroll the chat to the message you want (it's highlighted under the
mouse) and click it. The capture then runs from that message to the end.
Press **Esc** or **Cancel** to back out without capturing.

> While it runs, don't scroll, switch chats, or resize the window.

## How it works

```
popup.js ──START_CAPTURE──▶ content.js (in the WhatsApp tab)
                                │
                                │ 1. find the scrollable message list
                                │ 2. scroll to top until height is stable
                                │    (forces lazy-load of oldest messages)
                                │    — or, from a message: let the user pick
                                │    one and scroll it near the top
                                │ 3. step down ~85% of a viewport per step
                                │
                                ├─APPEND {crop rect in CSS px}─▶ background.js
                                │                                  │ captureVisibleTab()
                                │                                  │ scale CSS→bitmap px
                                │                                  │ draw strip onto OffscreenCanvas
                                │                                  │ start new segment at size limit
                                │◀──────────── ok ─────────────────┘
                                │
                                └─END──▶ background.js
                                            finalize segments → PNG → chrome.downloads
```

Key correctness details:

- **No double-capture / no gaps.** After scrolling down by `delta` pixels, the
  only new content is the bottom `delta` pixels of the viewport. That exact strip
  is what gets appended — the sum of strips equals the full conversation height.
- **Starting from a message.** The picked row is scrolled to 64px below the top
  of the list (clear of WhatsApp's floating date pill), re-aligning if older
  messages load above it meanwhile. The first frame is cropped from up to 8px
  above the row, never into the previous message; the rest works as above.
- **DPR-proof.** `background.js` computes `scale = bitmap.width / window.innerWidth`
  from the real screenshot, instead of trusting `devicePixelRatio`.
- **Service-worker friendly.** MV3 workers have no `URL.createObjectURL`, so the
  finished PNG is base64-encoded into a `data:` URL for `chrome.downloads`.

## Files

| File                  | Role                                                                 |
| --------------------- | -------------------------------------------------------------------- |
| `manifest.json`       | MV3 manifest: metadata, minimal permissions (activeTab/scripting/downloads), icons. |
| `content.js`          | Message picker, scroll + measure loop, crop-rect math, on-page progress overlay. |
| `background.js`       | Visible-tab capture, canvas stitching, segment splitting, download.  |
| `popup.html` / `popup.js` | Toolbar popup with the capture buttons + preflight checks.       |
| `icons/`              | Icon set (16/32/48/128) + 512 store icon + 440×280 promo tile.       |
| `tools/make_icons.py` | Regenerates all icons/assets (PIL).                                  |
| `tools/build-zip.sh`  | Builds a Web Store upload zip of just the runtime files.             |
| `PRIVACY.md`          | Privacy policy (collects nothing).                                   |
| `STORE_LISTING.md`    | Chrome Web Store listing copy + permission justifications.           |
| `CHANGELOG.md`        | Version history.                                                     |

## Build a store zip

```bash
bash tools/build-zip.sh
# → dist/whatsapp-full-chat-screenshot-v1.0.0.zip
```

## Known limitations

- Capture speed is bounded by Chrome's screenshot rate limit (~2/sec), so long
  chats take a while — let it run.
- A floating date pill (e.g. *Today*) can appear repeated between strips on some
  layouts — cosmetic only.
- WhatsApp can rename its CSS classes anytime. If capture can't find the message
  list, update the heuristic in `findScroller` (`content.js`); if messages can't
  be picked, update `ROW_SELECTORS`.

## Privacy

Nothing is collected or transmitted. See [PRIVACY.md](PRIVACY.md).

## Disclaimer

Not affiliated with, endorsed by, or sponsored by WhatsApp or Meta. "WhatsApp"
is a trademark of its respective owner. Use responsibly and respect the privacy
and consent of the people in your conversations.

## License

[MIT](LICENSE) © 2026 Jens Polomski
