(() => {
  const id = window.launcherVariant;
  const definition = window.LAUNCHER_VARIANTS.find((item) => item.id === id);
  window.launcherComparison = {
    variant: id,
    getEdition: () => document.body.dataset.edition,
    selectEdition: (edition) =>
      document
        .querySelector(
          '[data-edition="' + (edition === "yr" ? "yr" : "ra2") + '"]',
        )
        .click(),
    openPanel: (name) =>
      document.querySelector('[data-launcher-panel="' + name + '"]')?.click(),
    replay: () => document.dispatchEvent(new CustomEvent("comparison:replay")),
  };
  document.querySelector(".launcher-brand").href =
    "../launcher-comparison/variant.html?variant=" + id;
  document.querySelector(".launcher-nav a").href =
    "../launcher-comparison/play.html?variant=" + id;
  document.title = definition.name + " · RA2 design comparison";
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "../launcher-comparison/variants/" + id + ".css";
  style.onload = () => {
    const script = document.createElement("script");
    script.src = "../launcher-comparison/variants/" + id + ".js";
    script.onload = () => {
      document.documentElement.dataset.variantReady = "true";
      document.dispatchEvent(
        new CustomEvent("comparison:ready", { detail: definition }),
      );
    };
    script.onerror = () => {
      document.documentElement.dataset.variantError = "script";
    };
    document.head.append(script);
  };
  style.onerror = () => {
    document.documentElement.dataset.variantError = "style";
  };
  document.head.append(style);
})();
