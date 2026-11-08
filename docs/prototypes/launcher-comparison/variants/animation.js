/* Explicit beats via native Web Animations; no runtime/library dependency. */
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = matchMedia("(max-width: 767px)");
  const running = new Set();
  const entrance = new Set();
  const ease = getComputedStyle(document.documentElement)
    .getPropertyValue("--sequence-ease")
    .trim();
  let replayPending = false;
  function motion(element, keyframes, duration, delay = 0, isEntrance = false) {
    if (!element || !element.animate || reduced.matches || document.hidden)
      return;
    const animation = element.animate(keyframes, {
      duration,
      delay,
      easing: ease,
      fill: "backwards",
    });
    running.add(animation);
    if (isEntrance) entrance.add(animation);
    const cleanup = () => {
      running.delete(animation);
      entrance.delete(animation);
    };
    animation.finished.then(cleanup, cleanup);
    return animation;
  }
  function cancelEntrances() {
    for (const animation of entrance) animation.cancel();
    entrance.clear();
  }
  function replay() {
    cancelEntrances();
    if (document.hidden) {
      replayPending = true;
      return;
    }
    replayPending = false;
    if (reduced.matches) return;
    const step = narrow.matches ? 45 : 70;
    motion(
      document.querySelector(".launcher-art"),
      [
        { opacity: 0.76, transform: "scale(1.025)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      1000,
      0,
      true,
    );
    motion(
      document.querySelector(".launch-title"),
      [
        { opacity: 0.62, transform: "translateY(12px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      640,
      120,
      true,
    );
    [".launch-kicker", ".launch-welcome"].forEach((selector, index) => {
      motion(
        document.querySelector(selector),
        [
          { opacity: 0.72, transform: "translateY(6px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        460,
        150 + index * step,
        true,
      );
    });
    // Controls stay visible, at their final hitboxes, and usable on the first frame.
    [
      ".edition-choices",
      ".edition-summary",
      ".launch-actions",
      ".launch-shortcut",
      ".collection-bar",
    ].forEach((selector, index) => {
      motion(
        document.querySelector(selector),
        [{ opacity: 0.8 }, { opacity: 1 }],
        420,
        220 + index * step,
        true,
      );
    });
  }
  let edition = document.body.dataset.edition;
  new MutationObserver(() => {
    const next = document.body.dataset.edition;
    if (next === edition) return;
    edition = next;
    cancelEntrances();
    for (const selector of [".launch-title", ".edition-summary"]) {
      const element = document.querySelector(selector);
      // Rapid tab changes replace any in-flight transition on the same element.
      element?.getAnimations().forEach((animation) => animation.cancel());
      motion(
        element,
        [
          { opacity: 0.68, transform: "translateY(4px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        220,
      );
    }
  }).observe(document.body, {
    attributes: true,
    attributeFilter: ["data-edition"],
  });
  const dialog = document.getElementById("launcher-dialog");
  if (dialog)
    new MutationObserver(() => {
      if (!dialog.open) return;
      motion(
        dialog,
        [
          { opacity: 0.72, transform: "translateY(12px) scale(0.985)" },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ],
        280,
      );
    }).observe(dialog, { attributes: true, attributeFilter: ["open"] });
  document.addEventListener("comparison:replay", replay);
  // Interaction ends the introduction immediately; it never delays a command.
  document.addEventListener("pointerdown", cancelEntrances, {
    capture: true,
    passive: true,
  });
  document.addEventListener("keydown", cancelEntrances, { capture: true });
  document.addEventListener("focusin", cancelEntrances);
  document.addEventListener("visibilitychange", () => {
    for (const animation of running) {
      if (document.hidden) animation.pause();
      else animation.play();
    }
    if (!document.hidden && replayPending) replay();
  });
  reduced.addEventListener("change", () => {
    if (reduced.matches) {
      for (const animation of running) animation.cancel();
      running.clear();
      entrance.clear();
    }
  });
  replay();
})();
