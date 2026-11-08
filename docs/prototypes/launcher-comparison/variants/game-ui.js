/* Mission console: organize existing controls, retaining their shared event listeners. */
(() => {
  const main = document.querySelector(".launcher-main");
  const content = document.querySelector(".launch-content");
  const editions = document.querySelector(".edition-choices");
  const collection = document.querySelector(".collection-bar");
  const dialog = document.getElementById("launcher-dialog");
  const rail = document.createElement("aside");
  rail.className = "mission-rail";
  rail.setAttribute("aria-label", "Game library and installation");
  const editionGroup = document.createElement("section");
  editionGroup.className = "mission-edition-group";
  const heading = document.createElement("h2");
  heading.id = "mission-editions-heading";
  heading.className = "mission-section-label";
  heading.textContent = "01 / Choose your game";
  editionGroup.setAttribute("aria-labelledby", heading.id);
  editionGroup.append(heading, editions);
  rail.append(editionGroup, collection);
  main.prepend(rail);
  content.setAttribute("aria-label", "Selected game and launch");
  const stage = document.createElement("p");
  stage.className = "mission-stage-label";
  stage.textContent = "02 / Prepare to deploy";
  content.prepend(stage);
  document.querySelector(".launch-shortcut").textContent =
    "Choose an edition. Set your options. Take command.";
  document.querySelector(".art-caption").textContent =
    "MISSION CONSOLE / CLASSIC WARFARE";
  document.querySelector(".collection-choice small").textContent =
    "ACTIVE INSTALLATION";
  const toolHeading = document.createElement("p");
  toolHeading.className = "mission-section-label mission-tools-label";
  toolHeading.textContent = "Collection tools";
  collection.insertBefore(
    toolHeading,
    document.querySelector(".collection-tools"),
  );

  // Vertical navigation matches the desktop library; horizontal arrows remain shared.
  editions.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const buttons = [...editions.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      buttons[
        (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length
      ];
    next.click();
    next.focus();
  });
  const tools = document.querySelector(".collection-tools");
  tools.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = [...tools.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next].focus();
  });

  // The native modal is the top screen: it traps input and the shell is also inert.
  // This supplements shared close behavior with Escape focus restoration.
  let returnFocus = null;
  document.addEventListener(
    "click",
    (event) => {
      const trigger = event.target.closest("[data-launcher-panel]");
      if (trigger) returnFocus = trigger;
    },
    true,
  );
  const shell = document.getElementById("launcher-screen");
  new MutationObserver(() => {
    shell.inert = dialog.open;
    document.body.dataset.missionScreen = dialog.open ? "utility" : "library";
    if (dialog.open && !dialog.contains(document.activeElement)) {
      document.getElementById("launcher-dialog-done").focus();
    }
  }).observe(dialog, { attributes: true, attributeFilter: ["open"] });
  dialog.addEventListener("close", () => {
    shell.inert = false;
    returnFocus?.focus({ preventScroll: true });
  });
  document.body.dataset.missionScreen = "library";
  if (window.top === window.self) {
    document.getElementById("resume-button").focus({ preventScroll: true });
  }
})();
