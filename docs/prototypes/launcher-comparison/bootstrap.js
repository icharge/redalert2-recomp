(() => {
  const requested = new URLSearchParams(location.search).get("variant");
  window.launcherVariant = window.LAUNCHER_VARIANTS.some(
    (item) => item.id === requested,
  )
    ? requested
    : "skeuomorphic";
  document.documentElement.dataset.launcherVariant = window.launcherVariant;
})();
