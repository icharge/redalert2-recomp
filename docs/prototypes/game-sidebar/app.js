/* Standalone UI spike. Does not import, start, or modify the game runtime. */
(() => {
  const $ = (id) => document.getElementById(id);
  const key = "ra2.sidebar-poc.v1";
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(key) || "{}") || {};
  } catch {
    /* Session defaults. */
  }
  const state = {
    pinned: saved.pinned === true,
    focusMute: saved.focusMute === true,
    volume: Number.isFinite(saved.volume)
      ? Math.max(0, Math.min(100, saved.volume))
      : 65,
    previousVolume:
      Number.isFinite(saved.previousVolume) && saved.previousVolume > 0
        ? Math.min(100, saved.previousVolume)
        : Number.isFinite(saved.volume) && saved.volume > 0
          ? Math.min(100, saved.volume)
          : 65,
    scaling: ["sharp", "smooth", "crt", "nearest", "integer"].includes(
      saved.scaling,
    )
      ? saved.scaling
      : "sharp",
    bars: saved.bars !== false,
    hd: saved.hd !== false,
    modern: saved.modern !== false,
    hover: false,
    focus: false,
    touch: false,
    popover: null,
    dialog: null,
    pointerLocked: false,
    playing: false,
    launcher: false,
  };
  const sidebar = $("sidebar");
  const viewport = $("game-viewport");
  let collapseTimer, noticeTimer, returnTimer;
  let idleTimer = null;
  let context,
    volumeGain,
    focusGain,
    oscillators = [];
  let dialogTrigger = null;
  let keyboardNavigation = false;
  let audioGeneration = 0;

  function railHasKeyboardFocus() {
    const active = document.activeElement;
    return (
      sidebar.contains(active) &&
      (keyboardNavigation || active.matches(":focus-visible"))
    );
  }
  document.addEventListener(
    "keydown",
    (event) => {
      if (["Tab", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        keyboardNavigation = true;
        if (sidebar.contains(document.activeElement)) {
          state.focus = true;
          keepOpen();
        }
      }
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      keyboardNavigation = false;
      state.focus = false;
    },
    true,
  );

  function sidebarIsActive() {
    return (
      state.hover ||
      state.focus ||
      state.popover ||
      state.dialog ||
      state.launcher
    );
  }
  function wakeSidebar() {
    clearTimeout(idleTimer);
    idleTimer = null;
    sidebar.dataset.inactive = "false";
  }
  function syncSidebarIdle() {
    if (sidebarIsActive()) {
      wakeSidebar();
    } else if (idleTimer === null && sidebar.dataset.inactive !== "true") {
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (!sidebarIsActive()) sidebar.dataset.inactive = "true";
      }, 1000);
    }
  }

  function persist() {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          pinned: state.pinned,
          focusMute: state.focusMute,
          volume: state.volume,
          previousVolume: state.previousVolume,
          scaling: state.scaling,
          bars: state.bars,
          hd: state.hd,
          modern: state.modern,
        }),
      );
    } catch {
      /* Prototype stays usable. */
    }
  }
  function renderRail() {
    const pinnedOpen = state.pinned && innerWidth >= 768;
    const expanded =
      pinnedOpen ||
      state.touch ||
      state.popover ||
      state.dialog ||
      (!state.pointerLocked && (state.hover || state.focus));
    sidebar.dataset.expanded = String(!!expanded);
    sidebar.dataset.pinned = String(state.pinned);
    document.documentElement.style.setProperty(
      "--rail-visible",
      expanded ? "184px" : "56px",
    );
    document.documentElement.style.setProperty(
      "--rail-reserved",
      state.pinned && innerWidth >= 768 ? "184px" : "56px",
    );
    $("pin-button").setAttribute("aria-pressed", String(state.pinned));
    $("pin-button").setAttribute(
      "aria-label",
      state.pinned ? "Unpin sidebar" : "Pin sidebar",
    );
    $("pin-button").title = state.pinned ? "Unpin sidebar" : "Pin sidebar";
    $("pin-label").textContent = state.pinned ? "Unpin sidebar" : "Pin sidebar";
    const expansionLabel = expanded ? "Collapse sidebar" : "Expand sidebar";
    $("expand-button").setAttribute("aria-label", expansionLabel);
    $("expand-button").setAttribute("aria-expanded", String(!!expanded));
    $("expand-button").querySelector(".rail-label").textContent =
      expansionLabel;
    $("expand-button").disabled = pinnedOpen;
    for (const name of ["home", "sound", "settings", "more"]) {
      $(name + "-button").dataset.selected = String(
        state.popover === name || state.dialog === name,
      );
    }
    for (const button of sidebar.querySelectorAll(".rail-action")) {
      button.title = expanded ? "" : button.getAttribute("aria-label");
    }
    positionPopover();
    syncSidebarIdle();
  }
  function keepOpen() {
    clearTimeout(collapseTimer);
    wakeSidebar();
    renderRail();
  }
  function scheduleCollapse() {
    clearTimeout(collapseTimer);
    syncSidebarIdle();
    collapseTimer = setTimeout(renderRail, 250);
  }
  sidebar.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch" || state.pointerLocked) return;
    state.hover = true;
    keepOpen();
  });
  sidebar.addEventListener("pointerleave", () => {
    state.hover = false;
    scheduleCollapse();
  });
  sidebar.addEventListener("focusin", () => {
    state.focus = railHasKeyboardFocus();
    keepOpen();
  });
  sidebar.addEventListener("focusout", () => {
    queueMicrotask(() => {
      state.focus = railHasKeyboardFocus();
      scheduleCollapse();
    });
  });
  $("pin-button").addEventListener("click", () => {
    state.pinned = !state.pinned;
    persist();
    keepOpen();
  });
  $("expand-button").addEventListener("click", () => {
    state.touch = sidebar.dataset.expanded !== "true";
    if (!state.touch && !state.pinned) {
      state.hover = false;
      state.focus = false;
      $("expand-button").blur();
    }
    keepOpen();
  });
  addEventListener("resize", renderRail);

  function positionPopover() {
    if (!state.popover) return;
    const panel = $(state.popover + "-panel");
    const trigger = $(state.popover + "-button");
    const top = Math.max(
      12,
      Math.min(
        trigger.getBoundingClientRect().top,
        innerHeight - panel.offsetHeight - 12,
      ),
    );
    panel.style.top = top + "px";
    panel.style.bottom = "auto";
  }

  function notice(message) {
    clearTimeout(noticeTimer);
    $("notice").textContent = message;
    $("notice").hidden = false;
    noticeTimer = setTimeout(() => {
      $("notice").hidden = true;
    }, 4000);
  }
  function closePopover(restore = true) {
    const previous = state.popover;
    state.popover = null;
    $("sound-panel").hidden = true;
    $("more-panel").hidden = true;
    $("sound-button").setAttribute("aria-expanded", "false");
    $("more-button").setAttribute("aria-expanded", "false");
    if (restore && previous) $(previous + "-button").focus();
    renderRail();
    scheduleCollapse();
  }
  function openPopover(name) {
    if (state.popover === name) {
      closePopover();
      return;
    }
    closePopover(false);
    state.popover = name;
    $(name + "-panel").hidden = false;
    $(name + "-button").setAttribute("aria-expanded", "true");
    keepOpen();
    $(name + "-panel")
      .querySelector("input, button")
      .focus({ preventScroll: true });
  }
  $("sound-button").addEventListener("click", () => openPopover("sound"));
  $("more-button").addEventListener("click", () => openPopover("more"));
  document
    .querySelectorAll("[data-close-popover]")
    .forEach((button) =>
      button.addEventListener("click", () => closePopover()),
    );
  document.addEventListener("pointerdown", (event) => {
    if (!state.popover || state.dialog) return;
    if (
      !$(state.popover + "-panel").contains(event.target) &&
      !sidebar.contains(event.target)
    )
      closePopover(false);
  });
  $("more-panel").addEventListener("keydown", (event) => {
    const items = [...$("more-panel").querySelectorAll("button")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[
        (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length
      ].focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1].focus();
    }
  });
  for (const name of ["sound", "more"]) {
    $(name + "-panel").addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const items = [
        ...$(name + "-panel").querySelectorAll("button:not(:disabled), input"),
      ];
      const atEdge = event.shiftKey
        ? document.activeElement === items[0]
        : document.activeElement === items.at(-1);
      if (!atEdge) return;
      event.preventDefault();
      closePopover(false);
      const actions = [
        ...sidebar.querySelectorAll("button:not(:disabled)"),
      ].filter((button) => button.getClientRects().length > 0);
      const triggerIndex = actions.indexOf($(name + "-button"));
      actions[
        event.shiftKey ? triggerIndex : (triggerIndex + 1) % actions.length
      ].focus();
    });
  }

  function openDialog(name, trigger) {
    closePopover(false);
    if (state.dialog) $(state.dialog + "-dialog").close();
    if (document.pointerLockElement) document.exitPointerLock();
    state.dialog = name;
    dialogTrigger = trigger;
    keepOpen();
    $(name + "-dialog").showModal();
    $(name + "-dialog").scrollTop = 0;
    if (name === "home") $("stay-button").focus();
  }
  function closeDialog(backToGame = true) {
    if (!state.dialog) return;
    const dialog = $(state.dialog + "-dialog");
    dialog.close();
    state.dialog = null;
    state.touch = false;
    state.hover = false;
    state.focus = false;
    if (backToGame) viewport.focus({ preventScroll: true });
    else dialogTrigger?.focus({ preventScroll: true });
    renderRail();
  }
  $("settings-button").addEventListener("click", () =>
    openDialog("settings", $("settings-button")),
  );
  $("home-button").addEventListener("click", () =>
    openDialog("home", $("home-button")),
  );
  $("stay-button").addEventListener("click", () => closeDialog());
  document
    .querySelectorAll("[data-close-dialog]")
    .forEach((button) => button.addEventListener("click", () => closeDialog()));
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!returnTimer) closeDialog();
    });
    // Native modal backdrop clicks never confirm or dismiss Home.
  });
  $("return-button").addEventListener("click", () => {
    if (returnTimer) return;
    $("return-button").disabled = true;
    $("stay-button").disabled = true;
    $("return-button").setAttribute("aria-busy", "true");
    $("return-button").textContent = "Returning…";
    stopAudio();
    returnTimer = setTimeout(() => {
      closeDialog(false);
      state.launcher = true;
      $("play-screen").hidden = true;
      $("launcher-screen").hidden = false;
      $("launcher-title").focus();
      $("return-button").disabled = false;
      $("stay-button").disabled = false;
      $("return-button").removeAttribute("aria-busy");
      $("return-button").textContent = "Return to launcher";
      returnTimer = null;
    }, 450);
  });
  $("resume-button").addEventListener("click", () => {
    state.launcher = false;
    state.hover = false;
    state.focus = false;
    state.touch = false;
    $("launcher-screen").hidden = true;
    $("play-screen").hidden = false;
    viewport.focus();
    renderRail();
  });

  const details = {
    keyboard: [
      "Keyboard input",
      '<p class="helper">Try typing here. Text stays in this prototype and is not sent to a game.</p><textarea aria-label="Game text input" placeholder="Type a message…"></textarea>',
    ],
    lan: [
      "LAN multiplayer",
      '<p class="helper">This is the entry point for the existing LAN pairing dialog. No network connection is started in this prototype.</p>',
    ],
    files: [
      "Browse files",
      '<p class="helper">The live game file browser will open here. This prototype does not access or change your game files.</p>',
    ],
    shortcuts: [
      "Keyboard shortcuts",
      '<div class="shortcut-row"><span>Game settings</span><kbd>F10</kbd></div><div class="shortcut-row"><span>Fullscreen</span><kbd>Alt + Enter</kbd></div><div class="shortcut-row"><span>Close controls / release pointer</span><kbd>Esc</kbd></div>',
    ],
  };
  document.querySelectorAll("[data-detail]").forEach((button) =>
    button.addEventListener("click", () => {
      const [title, content] = details[button.dataset.detail];
      $("detail-title").textContent = title;
      $("detail-content").innerHTML = content;
      openDialog("detail", $("more-button"));
    }),
  );

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      notice(
        "Fullscreen is unavailable in this preview. Try opening it in your browser.",
      );
    }
  }
  $("fullscreen-button").addEventListener("click", () => {
    closePopover(false);
    void toggleFullscreen();
  });
  document.addEventListener("fullscreenchange", () => {
    const on = !!document.fullscreenElement;
    $("fullscreen-button").setAttribute("aria-pressed", String(on));
    $("fullscreen-button").setAttribute(
      "aria-label",
      on ? "Exit fullscreen" : "Fullscreen",
    );
    $("fullscreen-label").textContent = on ? "Exit fullscreen" : "Fullscreen";
  });
  $("capture-pointer").addEventListener("click", async () => {
    closePopover(false);
    state.touch = false;
    viewport.focus();
    try {
      await viewport.requestPointerLock();
    } catch {
      notice("Pointer capture is unavailable in this browser.");
    }
  });
  document.addEventListener("pointerlockchange", () => {
    state.pointerLocked = !!document.pointerLockElement;
    state.hover = false;
    state.focus = false;
    $("preview-note").textContent = state.pointerLocked
      ? "Pointer captured · press Esc to release"
      : "Interactive controls · gameplay is a still image";
    renderRail();
  });
  document.addEventListener("keydown", (event) => {
    if (state.launcher) return;
    if (event.code === "F10") {
      event.preventDefault();
      if (state.dialog === "settings") closeDialog();
      else if (!state.dialog) openDialog("settings", $("settings-button"));
    } else if (event.altKey && event.code === "Enter") {
      event.preventDefault();
      void toggleFullscreen();
    } else if (event.key === "Escape" && state.popover && !state.dialog) {
      event.preventDefault();
      closePopover();
    }
  });

  function isFocusMuted() {
    return (
      state.focusMute &&
      (document.visibilityState === "hidden" || !document.hasFocus())
    );
  }
  function updateAudio() {
    if (context && volumeGain && focusGain) {
      volumeGain.gain.setValueAtTime(state.volume / 100, context.currentTime);
      focusGain.gain.setValueAtTime(
        isFocusMuted() ? 0 : 1,
        context.currentTime,
      );
    }
    for (const id of ["quick-volume", "settings-volume"]) {
      $(id).value = state.volume;
      $(id).style.setProperty("--volume-fill", state.volume + "%");
    }
    for (const id of ["quick-volume-output", "settings-volume-output"])
      $(id).textContent = state.volume + "%";
    $("focus-mute").checked = state.focusMute;
    $("quick-mute").textContent = state.volume === 0 ? "Unmute" : "Mute";
    $("quick-mute").setAttribute("aria-pressed", String(state.volume === 0));
    $("sound-icon").setAttribute(
      "href",
      state.volume === 0 || isFocusMuted() ? "#muted" : "#sound",
    );
    document.querySelectorAll(".demo-audio").forEach((button) => {
      button.textContent = state.playing
        ? "Stop test sound"
        : "Play test sound";
    });
    const label = !state.playing
      ? "Test sound is off."
      : isFocusMuted()
        ? "Muted while page is away."
        : state.volume === 0
          ? "Muted · volume is 0%."
          : "Playing a quiet test tone.";
    document.querySelectorAll(".audio-status").forEach((element) => {
      element.textContent = label;
    });
  }
  async function startAudio() {
    const generation = ++audioGeneration;
    if (!context) {
      context = new AudioContext();
      volumeGain = context.createGain();
      focusGain = context.createGain();
      volumeGain.gain.value = state.volume / 100;
      focusGain.gain.value = isFocusMuted() ? 0 : 1;
      volumeGain.connect(focusGain);
      focusGain.connect(context.destination);
    }
    await context.resume();
    if (generation !== audioGeneration || state.launcher || !context) return;
    oscillators = [220, 330].map((frequency) => {
      const oscillator = context.createOscillator();
      const level = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      level.gain.value = 0.018;
      oscillator.connect(level);
      level.connect(volumeGain);
      oscillator.start();
      return { oscillator, level };
    });
    state.playing = true;
    updateAudio();
  }
  function stopAudio() {
    audioGeneration++;
    for (const { oscillator, level } of oscillators) {
      oscillator.stop();
      oscillator.disconnect();
      level.disconnect();
    }
    oscillators = [];
    state.playing = false;
    updateAudio();
  }
  document.querySelectorAll(".demo-audio").forEach((button) =>
    button.addEventListener("click", async () => {
      if (state.playing) stopAudio();
      else {
        document.querySelectorAll(".demo-audio").forEach((item) => {
          item.disabled = true;
        });
        try {
          await startAudio();
        } catch {
          notice("Audio could not start in this browser.");
        } finally {
          document.querySelectorAll(".demo-audio").forEach((item) => {
            item.disabled = false;
          });
        }
      }
    }),
  );
  for (const id of ["quick-volume", "settings-volume"])
    $(id).addEventListener("input", (event) => {
      state.volume = Number(event.target.value);
      if (state.volume > 0) state.previousVolume = state.volume;
      persist();
      updateAudio();
    });
  $("quick-mute").addEventListener("click", () => {
    if (state.volume === 0) state.volume = state.previousVolume || 65;
    else {
      state.previousVolume = state.volume;
      state.volume = 0;
    }
    persist();
    updateAudio();
  });
  $("focus-mute").addEventListener("change", (event) => {
    state.focusMute = event.target.checked;
    persist();
    updateAudio();
  });
  document.addEventListener("visibilitychange", updateAudio);
  addEventListener("focus", updateAudio);
  addEventListener("blur", updateAudio);
  $("scaling").addEventListener("change", (event) => {
    state.scaling = event.target.value;
    viewport.dataset.scaling = event.target.value;
    persist();
  });
  $("blur-bars").addEventListener("change", (event) => {
    state.bars = event.target.checked;
    viewport.dataset.blur = String(event.target.checked);
    persist();
  });
  for (const [id, field] of [
    ["hd-vehicles", "hd"],
    ["modern-controls", "modern"],
  ]) {
    $(id).addEventListener("change", (event) => {
      state[field] = event.target.checked;
      persist();
    });
  }
  addEventListener("pagehide", () => {
    clearTimeout(collapseTimer);
    clearTimeout(idleTimer);
    clearTimeout(returnTimer);
    stopAudio();
    void context?.close();
    context = null;
    volumeGain = null;
    focusGain = null;
  });
  $("scaling").value = state.scaling;
  viewport.dataset.scaling = state.scaling;
  viewport.dataset.blur = String(state.bars);
  $("blur-bars").checked = state.bars;
  $("hd-vehicles").checked = state.hd;
  $("modern-controls").checked = state.modern;
  renderRail();
  updateAudio();
})();
