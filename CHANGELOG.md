# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-14

### Added

- **Capture from a message…**: a second popup button that lets you pick the
  message where the capture should start (hover highlights it, click picks it,
  Esc or Cancel aborts). The image then runs from just above that message to the
  end of the conversation. Date separators and system notices can be picked too.
  No new permissions.

### Changed

- While capturing, a transparent layer covers the page so the mouse can't
  trigger WhatsApp's hover controls (reaction / menu buttons) into the image or
  accidentally scroll/click the chat.
- The progress percentage is now measured from where the capture starts.

## [1.0.1] - 2026-06-13

### Changed

- Minimized permissions to the three actually used: `activeTab`, `scripting`,
  `downloads`. Removed `tabs` and `storage` (unused).
- Removed `host_permissions` and the static `content_scripts` declaration. The
  capture script is now injected on demand via `scripting` + `activeTab` when the
  user clicks the toolbar button. This avoids a broad host permission and the
  associated in-depth Web Store review, with no change in behavior.

## [1.0.0] - 2026-06-13

### Added

- One-click capture of an entire WhatsApp Web conversation into stitched PNG(s).
- Auto scroll-to-top that lazy-loads the oldest messages before capturing.
- Seamless strip-stitching (each step appends only the newly revealed pixels —
  no overlap, no gap).
- Automatic splitting into multiple `partNN.png` files for conversations taller
  than the browser's canvas limit.
- dpr-proof scaling (derives scale from the captured bitmap, not an assumed
  device pixel ratio).
- On-page progress overlay with a Cancel button; overlay is hidden during each
  capture so it is never baked into the image.
- Extension icon set and toolbar popup.
