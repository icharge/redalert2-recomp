/* Discrete feedback only. Animations never intercept input or delay navigation. */
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const active = new Map();
  const timers = new Set();
  const response = document.createElement("div");
  response.className = "command-response";
  response.innerHTML =
    '<span class="command-response-mark" aria-hidden="true">✓</span><div class="command-response-copy"><span class="command-response-label">COMMAND FEEDBACK</span><span class="command-response-message" role="status" aria-live="polite">Ready for your command.</span></div><button class="command-feedback-test" type="button" aria-label="Test command feedback without launching">Test feedback</button>';
  document.querySelector(".launch-content").append(response);
  const message = response.querySelector(".command-response-message");
  const play = document.getElementById("resume-button");
  const dialog = document.getElementById("launcher-dialog");
  let responseTimer;
  function later(callback, duration) {
    const id = setTimeout(() => {
      timers.delete(id);
      callback();
    }, duration);
    timers.add(id);
    return id;
  }
  function animate(
    element,
    frames,
    duration,
    easing = "cubic-bezier(.16,.8,.24,1)",
  ) {
    if (!element || reduced.matches || document.hidden) return;
    active.get(element)?.cancel();
    const animation = element.animate(frames, { duration, easing });
    active.set(element, animation);
    animation.onfinish = () => {
      if (active.get(element) === animation) active.delete(element);
    };
  }
  function respond(text) {
    message.textContent = text;
    response.dataset.responding = "true";
    clearTimeout(responseTimer);
    timers.delete(responseTimer);
    responseTimer = later(() => {
      response.dataset.responding = "false";
      message.textContent = "Ready for your command.";
    }, 1200);
    animate(
      response.querySelector(".command-response-mark"),
      [
        { transform: "scale(.86)" },
        { transform: "scale(1.08)", offset: 0.45 },
        { transform: "scale(1)" },
      ],
      260,
    );
  }
  function confirmSelection(button) {
    animate(
      button,
      [
        {
          transform: "scale(.985)",
          boxShadow: "inset 0 0 0 1px var(--feel-confirm)",
        },
        {
          transform: "scale(1.012)",
          offset: 0.45,
          boxShadow: "inset 0 0 0 1px var(--feel-confirm)",
        },
        { transform: "scale(1)", boxShadow: "inset 0 0 0 0px transparent" },
      ],
      280,
    );
    animate(
      document.getElementById("launcher-title"),
      [
        { opacity: 0.76, transform: "translateY(3px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      220,
    );
    respond(
      (button.dataset.edition === "yr" ? "Yuri’s Revenge" : "Red Alert 2") +
        " selected.",
    );
  }
  function launchFeedback(isTest) {
    animate(
      play,
      [
        {
          transform: "translateY(2px) scale(.99)",
          boxShadow: "inset 0 0 0 1px var(--feel-confirm), 0 2px 0 #4d1a16",
        },
        {
          transform: "translateY(-1px) scale(1.015)",
          offset: 0.42,
          boxShadow: "inset 0 0 0 1px var(--feel-confirm), 0 5px 0 #4d1a16",
        },
        {
          transform: "translateY(0) scale(1)",
          boxShadow: "inset 0 1px 0 #ffffff24, 0 4px 0 #4d1a16",
        },
      ],
      360,
    );
    animate(
      play.querySelector(".launch-arrow"),
      [
        { transform: "translateX(0)" },
        { transform: "translateX(5px)", offset: 0.42 },
        { transform: "translateX(0)" },
      ],
      340,
    );
    respond(
      isTest ? "Feedback preview. Ready to deploy." : "Launching game preview.",
    );
  }
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const button = event.target.closest("button, .launch-primary");
    if (!button || button.disabled) return;
    animate(
      button,
      [
        { transform: "scale(1)" },
        { transform: "scale(.98)" },
        { transform: "scale(1)" },
      ],
      150,
    );
    if (button === play) {
      respond("Launch command ready.");
      animate(
        play.querySelector(".launch-arrow"),
        [
          { transform: "translateX(0)" },
          { transform: "translateX(4px)" },
          { transform: "translateX(0)" },
        ],
        220,
      );
    }
  });
  document.querySelectorAll(".edition-choice").forEach((button) => {
    button.addEventListener("click", () => confirmSelection(button));
  });
  // Existing clicks still own real actions. Test/replay invokes only their visual response.
  play.addEventListener("click", () => launchFeedback(false));
  document.querySelectorAll("[data-launcher-panel]").forEach((button) => {
    button.addEventListener("click", () => respond("Command acknowledged."));
  });
  dialog.addEventListener("close", () => respond("Returned to launcher."));
  function preview() {
    if (dialog.open || document.hidden) return;
    confirmSelection(
      document.querySelector('.edition-choice[aria-selected="true"]'),
    );
    later(() => launchFeedback(true), 260);
  }
  response.querySelector("button").addEventListener("click", preview);
  document.addEventListener("comparison:replay", preview);
  function stop() {
    active.forEach((animation) => animation.cancel());
    active.clear();
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    response.dataset.responding = "false";
    message.textContent = "Ready for your command.";
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  reduced.addEventListener("change", stop);
  window.addEventListener("pagehide", stop);
})();
