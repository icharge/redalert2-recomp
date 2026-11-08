(() => {
  const $ = (id) => document.getElementById(id);
  const trials = window.LAUNCHER_VARIANTS;
  const query = new URLSearchParams(location.search);
  let index = Math.max(
    0,
    trials.findIndex((trial) => trial.id === query.get("variant")),
  );
  for (const trial of trials) {
    const option = document.createElement("option");
    option.value = trial.id;
    option.textContent = trial.name;
    $("variant-picker").append(option);
  }
  function resizeFrames() {
    const mobile = $("viewport-picker").value === "mobile";
    const width = mobile ? 390 : 1440;
    const height = mobile ? 844 : 900;
    for (const stage of document.querySelectorAll(".frame-stage")) {
      if (!stage.clientWidth) continue;
      const scale = Math.min(1, stage.clientWidth / width);
      stage.style.height = height * scale + "px";
      const frame = stage.querySelector("iframe");
      frame.style.width = width + "px";
      frame.style.height = height + "px";
      frame.style.transform = "scale(" + scale + ")";
      frame.style.left = (stage.clientWidth - width * scale) / 2 + "px";
    }
  }
  function render() {
    const trial = trials[index];
    $("variant-picker").value = trial.id;
    $("active-kind").textContent = trial.kind + " / " + trial.skill;
    $("active-title").textContent = trial.name;
    $("active-description").textContent = trial.summary;
    $("source-link").href = trial.source;
    $("trial-frame-name").textContent =
      String(index + 1).padStart(2, "0") + " / " + trial.name;
    const url = "./variant.html?variant=" + trial.id;
    $("trial-frame").src = url;
    $("full-size-link").href = url;
    document.title = trial.name + " · RA2 live comparison";
    try {
      history.replaceState(null, "", "./preview.html?variant=" + trial.id);
    } catch {
      /* Local file URL policies vary. */
    }
    resizeFrames();
  }
  $("variant-picker").addEventListener("change", (event) => {
    index = trials.findIndex((trial) => trial.id === event.target.value);
    render();
  });
  $("viewport-picker").addEventListener("change", resizeFrames);
  $("show-original").addEventListener("change", (event) => {
    $("original-pane").hidden = !event.target.checked;
    $("preview-grid").dataset.single = String(!event.target.checked);
    resizeFrames();
  });
  $("replay-button").addEventListener("click", () => {
    $("trial-frame").src = "./variant.html?variant=" + trials[index].id;
  });
  $("previous-trial").addEventListener("click", () => {
    index = (index - 1 + trials.length) % trials.length;
    render();
  });
  $("next-trial").addEventListener("click", () => {
    index = (index + 1) % trials.length;
    render();
  });
  const observer = new ResizeObserver(resizeFrames);
  document
    .querySelectorAll(".frame-stage")
    .forEach((stage) => observer.observe(stage));
  addEventListener("pagehide", () => observer.disconnect());
  render();
})();
