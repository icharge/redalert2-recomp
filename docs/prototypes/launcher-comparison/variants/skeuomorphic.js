/* Industrial depth: reuse the original controls and their existing listeners. */
(() => {
  const main = document.querySelector(".launcher-main");
  if (!main || document.querySelector(".industrial-display")) return;
  const display = document.createElement("div");
  display.className = "industrial-display";
  display.setAttribute("aria-hidden", "true");
  const plate = document.createElement("div");
  plate.className = "industrial-plate";
  plate.innerHTML =
    "<span>COMMAND &amp; CONQUER</span><strong>CLASSIC WARFARE</strong><span>RED ALERT 2 / YURI’S REVENGE</span>";
  display.append(document.querySelector(".launcher-art"), plate);
  main.append(display);
  const caption = document.querySelector(".art-caption");
  if (caption) caption.remove();
  const rail = document.createElement("div");
  rail.className = "industrial-rail";
  rail.setAttribute("aria-hidden", "true");
  rail.innerHTML =
    "<span>COLLECTION CONSOLE</span><span>RA2 / RECOMPILED</span>";
  document.querySelector(".launcher-header").after(rail);
})();
