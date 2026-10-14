// Runs inside web.whatsapp.com. Drives the scroll-and-capture loop:
//  1. Find the scrollable message list inside the open chat.
//  2. Scroll to the very top, forcing WhatsApp to lazy-load the oldest messages
//     — or, in "from a message" mode, let the user pick a message and scroll
//     it to the top of the list instead.
//  3. Step downward, asking the background worker to capture + stitch the
//     newly revealed strip after each step (strip height == scroll delta,
//     so there is no overlap and no gap).
//  4. Tell background to finalize + download.

(() => {
  if (window.__waCapInit) return;
  window.__waCapInit = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const START_MARGIN = 8; // CSS px kept above the picked message (at most)
  // Where the picked message is parked before the first frame: low enough
  // that WhatsApp's floating date pill (top of the list) can't cover it.
  const START_ALIGN = 64;
  // Most specific first: the full-width list row, then the message wrapper.
  const ROW_SELECTORS = ['[role="row"]', "[data-id]", ".message-in, .message-out"];
  let running = false;
  let cancelFlag = false;
  let pickAbort = null; // set while the user is picking a message
  let overlayEl = null; // hidden during each capture so it isn't baked in

  function cancel() {
    cancelFlag = true;
    if (pickAbort) pickAbort();
  }

  // ---- on-page progress overlay -------------------------------------------
  function makeOverlay() {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:300px;" +
      "background:#111b21;color:#e9edef;font:13px/1.4 system-ui,Segoe UI,Roboto,sans-serif;" +
      "border:1px solid #2a3942;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);padding:14px;";
    const title = document.createElement("div");
    title.textContent = "Full Chat Screenshot";
    title.style.cssText = "font-weight:600;margin-bottom:6px;color:#25d366;";
    const status = document.createElement("div");
    status.textContent = "Starting…";
    status.style.cssText = "margin-bottom:10px;white-space:pre-wrap;word-break:break-word;";
    const btn = document.createElement("button");
    btn.textContent = "Cancel";
    btn.style.cssText =
      "background:#2a3942;color:#e9edef;border:0;border-radius:6px;padding:6px 12px;cursor:pointer;";
    btn.onclick = () => {
      status.textContent = "Cancelling…";
      cancel();
    };
    wrap.appendChild(title);
    wrap.appendChild(status);
    wrap.appendChild(btn);
    document.body.appendChild(wrap);
    overlayEl = wrap;

    return {
      set: (t) => {
        status.textContent = t;
      },
      done: (parts) => {
        status.textContent =
          "Done — saved " + parts + (parts > 1 ? " image parts." : " image.") + " Check your downloads.";
        btn.textContent = "Close";
        btn.onclick = () => wrap.remove();
        setTimeout(() => wrap.remove(), 8000);
      },
      fail: (msg) => {
        status.textContent = "Failed: " + msg;
        title.style.color = "#f15c6d";
        btn.textContent = "Close";
        btn.onclick = () => wrap.remove();
      },
      close: () => wrap.remove(),
    };
  }

  // Transparent layer over the page while capturing: keeps the mouse from
  // triggering WhatsApp's hover controls (reaction / menu buttons) on the
  // bubble under the cursor, and stops accidental clicks or wheel scrolls.
  // Being fully transparent, it never shows up in the screenshots.
  function makeShield() {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:transparent;";
    document.body.appendChild(el);
    return el;
  }

  // ---- locate the scrollable message list ---------------------------------
  function findScroller(main) {
    let best = null;
    let bestScore = -1;
    // Prefer the scrollable element that contains the most message rows.
    main.querySelectorAll("div").forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 150) {
        const n = el.querySelectorAll(".message-in,.message-out,[data-id]").length;
        if (n > bestScore) {
          bestScore = n;
          best = el;
        }
      }
    });
    if (best && bestScore > 0) return best;

    // Fallback: largest scrollable region.
    bestScore = -1;
    main.querySelectorAll("div").forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 150) {
        const area = el.clientHeight * el.clientWidth;
        if (area > bestScore) {
          bestScore = area;
          best = el;
        }
      }
    });
    return best;
  }

  // ---- "from a message" mode ----------------------------------------------
  // The message row (date separators and system notices count too) that
  // contains `el`, if `el` is inside the open chat's message list.
  function rowFor(el, scroller) {
    const main = document.querySelector("#main");
    if (!main || !el || !el.closest || !main.contains(el)) return null;
    for (const sel of ROW_SELECTORS) {
      const row = el.closest(sel);
      if (row && main.contains(row) && (!scroller || scroller.contains(row))) return row;
    }
    return null;
  }

  // Lets the user hover + click the message where the capture should start.
  // Resolves with that row, or null if cancelled (Cancel button or Esc).
  function pickMessage() {
    return new Promise((resolve) => {
      const box = document.createElement("div");
      box.style.cssText =
        "position:fixed;z-index:2147483646;pointer-events:none;display:none;box-sizing:border-box;" +
        "background:rgba(37,211,102,.12);border:2px solid #25d366;border-radius:6px;";
      const tag = document.createElement("div");
      tag.textContent = "Capture starts here";
      tag.style.cssText =
        "position:absolute;left:-2px;top:-2px;transform:translateY(-100%);background:#25d366;color:#0b141a;" +
        "font:600 11px/1 system-ui,Segoe UI,Roboto,sans-serif;padding:4px 6px;border-radius:6px 6px 0 0;";
      box.appendChild(tag);
      document.body.appendChild(box);

      let scroller = null;
      let mouseX = -1;
      let mouseY = -1;

      // The chat (and its list) can change while picking, e.g. if the user
      // opens another conversation, so re-find the list when it goes stale.
      function currentScroller() {
        if (!scroller || !scroller.isConnected) {
          const main = document.querySelector("#main");
          scroller = main ? findScroller(main) : null;
        }
        return scroller;
      }

      function paint() {
        const s = currentScroller();
        const row = mouseX < 0 ? null : rowFor(document.elementFromPoint(mouseX, mouseY), s);
        if (!row) {
          box.style.display = "none";
          return;
        }
        const r = row.getBoundingClientRect();
        // Clip to the visible part of the list (rows slide under the header).
        const v = s ? s.getBoundingClientRect() : r;
        const top = Math.max(r.top, v.top);
        const bottom = Math.min(r.bottom, v.bottom);
        if (bottom <= top) {
          box.style.display = "none";
          return;
        }
        box.style.display = "block";
        box.style.left = r.left + "px";
        box.style.top = top + "px";
        box.style.width = r.width + "px";
        box.style.height = bottom - top + "px";
      }

      const swallow = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      const onMove = (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        paint();
      };
      // Keep WhatsApp from reacting to presses on messages (opening media,
      // links, menus, selecting text) while picking.
      const onPress = (e) => {
        if (rowFor(e.target, currentScroller())) swallow(e);
      };
      const onClick = (e) => {
        const row = rowFor(e.target, currentScroller());
        if (!row) return;
        swallow(e);
        finish(row);
      };
      const onKey = (e) => {
        if (e.key !== "Escape") return;
        swallow(e); // Esc would otherwise close the chat in WhatsApp
        finish(null);
      };

      const PRESS = ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick"];
      function finish(row) {
        window.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("scroll", paint, true);
        PRESS.forEach((t) => window.removeEventListener(t, onPress, true));
        window.removeEventListener("click", onClick, true);
        window.removeEventListener("keydown", onKey, true);
        box.remove();
        pickAbort = null;
        resolve(row);
      }

      window.addEventListener("mousemove", onMove, true);
      document.addEventListener("scroll", paint, true); // content moves under the cursor
      PRESS.forEach((t) => window.addEventListener(t, onPress, true));
      window.addEventListener("click", onClick, true);
      window.addEventListener("keydown", onKey, true);
      pickAbort = () => finish(null);
    });
  }

  // Scroll so the picked row sits START_ALIGN px below the top of the list.
  // Repeats because scrolling up can make WhatsApp load older messages above
  // and shift everything; stops early when the list can't scroll any further
  // (row near the very top or bottom of the chat).
  async function scrollToMessage(s, row) {
    for (let i = 0; i < 8 && !cancelFlag; i++) {
      if (!row.isConnected) throw new Error("The selected message is no longer on the page. Try again.");
      const diff = row.getBoundingClientRect().top - (s.getBoundingClientRect().top + START_ALIGN);
      if (Math.abs(diff) < 1) break;
      const before = s.scrollTop;
      s.scrollTop = before + diff;
      await sleep(400);
      if (Math.abs(s.scrollTop - before) < 1) break;
    }
    await sleep(300);
  }

  // Top edge (viewport px) of the first frame when starting from `row`: up to
  // START_MARGIN above it, but never into the previous row, so no sliver of
  // the preceding message ends up at the top of the image.
  function startEdge(row) {
    const top = row.getBoundingClientRect().top;
    let edge = top - START_MARGIN;
    const prev = row.previousElementSibling;
    if (prev) {
      const prevBottom = prev.getBoundingClientRect().bottom;
      if (prevBottom <= top) edge = Math.max(edge, prevBottom);
    }
    return edge;
  }

  async function scrollToTop(s, ui) {
    let last = -1;
    let stable = 0;
    for (let i = 0; i < 600 && !cancelFlag; i++) {
      s.scrollTop = 0;
      await sleep(450);
      const h = s.scrollHeight;
      ui.set("Loading earlier messages…  (pass " + (i + 1) + ", height " + h + "px)");
      if (Math.abs(h - last) < 2) {
        if (++stable >= 3) break;
      } else {
        stable = 0;
      }
      last = h;
    }
    s.scrollTop = 0;
    await sleep(300);
  }

  async function append(rect) {
    // Hide the progress overlay so it isn't captured into the screenshot.
    if (overlayEl) overlayEl.style.visibility = "hidden";
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    try {
      const r = await chrome.runtime.sendMessage({
        type: "APPEND",
        sx: rect.x,
        sy: rect.y,
        sw: rect.w,
        sh: rect.h,
      });
      if (!r || !r.ok) throw new Error(r ? r.error : "capture failed");
    } finally {
      if (overlayEl) overlayEl.style.visibility = "visible";
    }
  }

  async function run(fromMessage) {
    if (running) return;
    running = true;
    cancelFlag = false;
    const ui = makeOverlay();
    let shield = null;
    try {
      let startRow = null;
      if (fromMessage) {
        ui.set("Click the message where the capture should start.\nScroll the chat to find it · Esc to cancel.");
        startRow = await pickMessage();
        if (!startRow) {
          ui.close();
          return;
        }
      }
      shield = makeShield();

      const main = document.querySelector("#main");
      if (!main) throw new Error("Open a chat first (no conversation is currently open).");
      const scroller = findScroller(main);
      if (!scroller) throw new Error("Could not find the message list. WhatsApp's layout may have changed.");

      if (startRow) {
        ui.set("Scrolling to the selected message…");
        await scrollToMessage(scroller, startRow);
      } else {
        ui.set("Scrolling to the start of the conversation…");
        await scrollToTop(scroller, ui);
      }
      if (cancelFlag) throw new Error("Cancelled");

      const header = main.querySelector("header");
      const chatName = (header ? header.innerText : "chat").split("\n")[0].trim().slice(0, 60);

      const begin = await chrome.runtime.sendMessage({
        type: "BEGIN",
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        chatName,
      });
      if (!begin || !begin.ok) throw new Error("Could not start capture session.");

      // First frame: the whole visible message viewport at the top — or, from
      // a message, the part from just above that message down.
      if (!startRow) scroller.scrollTop = 0;
      await sleep(350);
      const r0 = scroller.getBoundingClientRect();
      let top = r0.top;
      if (startRow) {
        if (!startRow.isConnected) throw new Error("The selected message is no longer on the page. Try again.");
        top = Math.min(Math.max(r0.top, startEdge(startRow)), r0.bottom - 1);
      }
      await append({ x: r0.left, y: top, w: r0.width, h: r0.bottom - top });
      let frames = 1;
      const startScroll = scroller.scrollTop;

      const step = Math.max(60, Math.floor(r0.height * 0.85));
      while (!cancelFlag) {
        const before = scroller.scrollTop;
        scroller.scrollTop = before + step;
        await sleep(360); // settle paint + stay under capture rate limit
        const after = scroller.scrollTop;
        const delta = after - before;
        if (delta <= 1) break; // reached the bottom

        const r = scroller.getBoundingClientRect();
        // Newly revealed content = bottom `delta` CSS px of the viewport.
        await append({ x: r.left, y: r.top + r.height - delta, w: r.width, h: delta });
        frames++;

        const denom = Math.max(1, scroller.scrollHeight - r.height - startScroll);
        const pct = Math.min(100, Math.round(((after - startScroll) / denom) * 100));
        ui.set("Capturing…  " + frames + " frames  (" + pct + "%)");

        if (after + r.height >= scroller.scrollHeight - 1) break; // at bottom
      }
      if (cancelFlag) throw new Error("Cancelled");

      ui.set("Building image…");
      const res = await chrome.runtime.sendMessage({ type: "END" });
      if (!res || !res.ok) throw new Error(res ? res.error : "finalize failed");
      ui.done(res.parts || 1);
    } catch (e) {
      try {
        await chrome.runtime.sendMessage({ type: "ABORT" });
      } catch (_) {}
      ui.fail(String(e && e.message ? e.message : e));
    } finally {
      if (shield) shield.remove();
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "START_CAPTURE") {
      if (running) {
        reply({ ok: false, error: "already running" });
      } else {
        run(msg.fromMessage === true);
        reply({ ok: true });
      }
      return; // synchronous reply
    }
    if (msg.type === "PING") {
      reply({ ok: true, hasChat: !!document.querySelector("#main") });
      return;
    }
  });
})();
