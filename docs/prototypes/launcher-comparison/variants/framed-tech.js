/* Command frames: asymmetrical artwork and control panels, original controls retained. */
(() => {
  const main = document.querySelector(".launcher-main");
  const content = document.querySelector(".launch-content");
  if (!main || !content || document.querySelector(".command-hero")) return;
  const hero = document.createElement("section");
  hero.className = "command-hero";
  hero.setAttribute("aria-labelledby", "launcher-title");
  const consolePanel = document.createElement("div");
  consolePanel.className = "command-console";
  const label = document.createElement("p");
  label.className = "command-section-label";
  label.textContent = "02 / LAUNCH CONTROL";
  consolePanel.append(label);
  hero.append(
    document.querySelector(".launcher-art"),
    document.querySelector(".launch-kicker"),
    document.querySelector(".launch-title"),
    document.querySelector(".art-caption"),
  );
  while (content.firstChild) consolePanel.append(content.firstChild);
  content.remove();
  main.append(hero, consolePanel);
  const rail = document.createElement("div");
  rail.className = "command-toprail";
  rail.setAttribute("aria-hidden", "true");
  rail.innerHTML =
    "<span>01 / CLASSIC COLLECTION</span><span>COMMAND INTERFACE / RECOMPILED</span>";
  main.before(rail);
})();
