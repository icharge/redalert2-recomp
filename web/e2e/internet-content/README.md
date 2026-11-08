# Internet content POC

Throwaway browser prototype for the first Internet page. It demonstrates loading **JSON content** or **styled HTML** independently of the game. The shell is a static local capture, with a CSS fallback; native action buttons are not connected. No production route, WOL behavior or WASM module is changed.

From `web/`:

```powershell
node e2e/internet-content.mjs
```

With the server running, `node e2e/internet-content-check.mjs` checks the loading paths in headless Chrome and writes screenshots under ignored `build-web/internet-content-poc/`.

Open [the local POC](http://127.0.0.1:5180/). Switch formats, edit `news.json` or `news.html`, then click **Load content**. The source field also accepts another HTTP(S) URL whose host permits CORS. **Slow load** and **Simulate failure** add query parameters understood by the demo server; they only simulate those states for its local fixture URLs. **Leave page** cancels pending requests; returning refreshes cached content.

HTML is fetched and displayed in an opaque-origin sandboxed `srcdoc` frame. Inline styles are supported. Scripts, forms, navigation privileges and remote subresources are not enabled; this is a content panel, not an arbitrary embedded application. Relative assets in a remote document are not resolved by this POC. Content requests omit credentials and time out after eight seconds. The 64 KiB check is after fetching and is not a streaming download limit.

Private shell artwork is served only when it already exists at `build-web/wol-menu-shots/internet.png` and `web/public/brand/bg-yr.webp`; it is never copied into the prototype. The preview still works without those assets.

The next integration step is the dialog-visibility/geometry bridge in [the proposed first-page plan](../../../docs/superpowers/plans/2026-11-08-internet-first-page.md), followed by using the actual game backdrop and controls. This POC does not implement that bridge.
