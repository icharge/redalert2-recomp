/* Retro-modern launcher prototype. Stores design preferences only; no game files are read. */
(() => {
  const $ = (id) => document.getElementById(id);
  const storageKey = "ra2.launcher-comparison." + window.launcherVariant;
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
  } catch {
    /* Session-only defaults. */
  }
  const state = {
    edition: stored.edition === "yr" ? "yr" : "ra2",
    name:
      typeof stored.name === "string" && stored.name.trim()
        ? stored.name.trim().slice(0, 48)
        : "Classic collection",
    resolution: ["game", "1280x720", "1920x1080", "2560x1440"].includes(
      stored.resolution,
    )
      ? stored.resolution
      : "game",
    fontFix: stored.fontFix === true,
  };
  let currentPanel = null;
  let trigger = null;
  const dialog = $("launcher-dialog");
  const editions = [...document.querySelectorAll("[data-edition]")];
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* Keep this session usable. */
    }
  }
  function renderEdition() {
    document.body.dataset.edition = state.edition;
    for (const button of editions) {
      const selected = button.dataset.edition === state.edition;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    const yuri = state.edition === "yr";
    $("edition-title-first").textContent = yuri ? "YURI’S" : "RED";
    $("edition-title-second").innerHTML = yuri ? "REVENGE" : "ALERT <b>2</b>";
    $("edition-description").textContent = yuri
      ? "A new enemy. A different kind of war."
      : "Allied or Soviet. Choose your side.";
    $("edition-summary").setAttribute(
      "aria-labelledby",
      yuri ? "edition-yr" : "edition-ra2",
    );
    $("resume-button").href =
      "../launcher-comparison/play.html?variant=" +
      window.launcherVariant +
      "&edition=" +
      state.edition;
    $("resume-button").setAttribute(
      "aria-label",
      "Play " + (yuri ? "Yuri’s Revenge" : "Red Alert 2"),
    );
    $("collection-name").textContent = state.name;
    document.title =
      (yuri ? "Yuri’s Revenge" : "Red Alert 2") + " · Launcher prototype";
  }
  editions.forEach((button, index) => {
    button.addEventListener("click", () => {
      state.edition = button.dataset.edition;
      persist();
      renderEdition();
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? editions.length - 1
            : (index +
                (event.key === "ArrowRight" ? 1 : -1) +
                editions.length) %
              editions.length;
      editions[next].click();
      editions[next].focus();
    });
  });
  const panels = {
    import: [
      "YOUR LIBRARY",
      "Add installation",
      '<p>Bring your own Red Alert 2 or Yuri’s Revenge game folder into your library.</p><p class="launch-empty-state">Your files. Your collection.</p><p class="preview-copy">This design preview does not import or modify files. The production launcher’s import flow stays unchanged.</p>',
    ],
    files: [
      "INSTALLATION",
      "Browse files",
      '<p>Your installation files will open in the existing file manager.</p><p class="preview-copy">No local files are loaded or changed by this prototype.</p>',
    ],
    saves: [
      "SAVED GAMES",
      "Ready for the next mission",
      '<p class="launch-empty-state">No saved games in this preview.</p><p>The full launcher keeps import and export actions here, scoped to your selected installation and edition.</p>',
    ],
    mods: [
      "MOD LIBRARY",
      "Make it your battlefield",
      '<p class="launch-empty-state">Original game</p><p>The existing mod manager will open here for the selected installation.</p><p class="preview-copy">This prototype does not load or change mods.</p>',
    ],
    installation: [
      "INSTALLATION",
      "Your collection",
      '<p>Give this preview collection a name.</p><label class="launch-field"><span>Collection name</span><input id="preview-collection-name" type="text" maxlength="48" autocomplete="off" /></label><p class="preview-copy">This only renames the prototype collection.</p>',
    ],
    settings: [
      "LAUNCH OPTIONS",
      "Game settings",
      '<p>Set up your next launch.</p><label class="launch-field"><span>Resolution</span><select id="launch-resolution"><option value="game">Use game setting</option><option value="1280x720">1280 × 720</option><option value="1920x1080">1920 × 1080</option><option value="2560x1440">2560 × 1440</option></select></label><label class="launch-checkbox"><input id="launch-font-fix" type="checkbox" /><span>Thai font fix</span></label><p class="preview-copy">These options are remembered for this design preview. They do not change the real game configuration.</p>',
    ],
  };
  function openPanel(name, button) {
    currentPanel = name;
    trigger = button;
    const [kicker, title, content] = panels[name];
    $("launcher-dialog-kicker").textContent = kicker;
    $("launcher-dialog-title").textContent = title;
    $("launcher-dialog-content").innerHTML = content;
    $("launcher-dialog-status").textContent = "";
    if (name === "settings") {
      $("launch-resolution").value = state.resolution;
      $("launch-font-fix").checked = state.fontFix;
      $("launch-resolution").addEventListener("change", (event) => {
        state.resolution = event.target.value;
        persist();
        $("launcher-dialog-status").textContent = "Preference saved";
      });
      $("launch-font-fix").addEventListener("change", (event) => {
        state.fontFix = event.target.checked;
        persist();
        $("launcher-dialog-status").textContent = "Preference saved";
      });
    }
    if (name === "installation") {
      $("preview-collection-name").value = state.name;
      $("launcher-dialog-done").textContent = "Save name";
    } else $("launcher-dialog-done").textContent = "Done";
    dialog.showModal();
    if (name === "installation") $("preview-collection-name").focus();
  }
  function closePanel() {
    if (currentPanel === "installation") {
      const name = $("preview-collection-name").value.trim();
      if (!name) {
        $("launcher-dialog-status").textContent = "Enter a collection name.";
        $("preview-collection-name").focus();
        return;
      }
      state.name = name;
      persist();
      renderEdition();
    }
    dialog.close();
    currentPanel = null;
    trigger?.focus();
  }
  document
    .querySelectorAll("[data-launcher-panel]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openPanel(button.dataset.launcherPanel, button),
      ),
    );
  $("launcher-dialog-done").addEventListener("click", closePanel);
  $("launcher-dialog-close").addEventListener("click", () => {
    dialog.close();
    currentPanel = null;
    trigger?.focus();
  });
  dialog.addEventListener("cancel", () => {
    currentPanel = null;
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && currentPanel === "installation") {
      event.preventDefault();
      closePanel();
    }
  });
  renderEdition();
})();
