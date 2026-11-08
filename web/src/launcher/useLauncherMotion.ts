import { useEffect, useRef, useState, type RefObject } from "react";
import type { LauncherTheme } from "../storage/launcher-theme";

/** Every animation, canvas frame and listener belongs to this effect's lifetime. */
export function useLauncherMotion(root: RefObject<HTMLDivElement | null>, theme: LauncherTheme) {
  const [feedback, setFeedback] = useState("Ready for your command.");
  const preview = useRef<() => void>(() => {});
  useEffect(() => {
    setFeedback("Ready for your command.");
    const host = root.current;
    if (!host || !window.matchMedia) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const animations = new Set<Animation>();
    const entrances = new Set<Animation>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let canvas: HTMLCanvasElement | undefined;
    let cleanupAtmosphere: (() => void) | undefined;
    const find = (selector: string) => host.querySelector<HTMLElement>(selector);
    function animate(
      element: HTMLElement | null,
      frames: Keyframe[],
      duration: number,
      delay = 0,
      entrance = false,
    ) {
      if (!element?.animate || reduced.matches || document.hidden) return;
      const animation = element.animate(frames, {
        duration,
        delay,
        easing: "cubic-bezier(.16,.8,.24,1)",
        fill: "backwards",
      });
      animations.add(animation);
      if (entrance) entrances.add(animation);
      const done = () => {
        animations.delete(animation);
        entrances.delete(animation);
      };
      void animation.finished.then(done, done);
    }
    function cancelEntrance() {
      entrances.forEach((a) => a.cancel());
      entrances.clear();
    }
    function stop() {
      animations.forEach((a) => a.cancel());
      animations.clear();
      entrances.clear();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      frame = 0;
    }
    function respond(text: string) {
      setFeedback(text);
      clearTimeout(timer);
      timer = setTimeout(() => setFeedback("Ready for your command."), 1200);
    }
    function testFeedback() {
      respond("Command acknowledged. Ready to deploy.");
      animate(
        find(".launch-primary"),
        [
          { transform: "translateY(2px) scale(.99)" },
          { transform: "translateY(-1px) scale(1.015)", offset: 0.42 },
          { transform: "translateY(0) scale(1)" },
        ],
        360,
      );
      animate(
        find(".command-response-mark"),
        [
          { transform: "scale(.86)" },
          { transform: "scale(1.08)", offset: 0.45 },
          { transform: "scale(1)" },
        ],
        260,
      );
    }
    function click(event: Event) {
      const target = (event.target as Element).closest<HTMLElement>("button, a");
      if (!target || target.matches(":disabled")) return;
      if (theme === "game-feel") {
        animate(
          target,
          [{ transform: "scale(1)" }, { transform: "scale(.98)" }, { transform: "scale(1)" }],
          180,
        );
        if (target.matches(".edition-choice"))
          respond(`${target.querySelector("strong")?.textContent ?? "Game"} selected.`);
      } else if (theme === "animation" && target.matches(".edition-choice")) {
        animate(
          find(".launch-title"),
          [
            { opacity: 0.68, transform: "translateY(4px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          220,
        );
      }
    }
    if (theme === "game-feel") preview.current = testFeedback;
    if (theme === "animation") {
      animate(
        find(".launcher-art"),
        [
          { opacity: 0.76, transform: "scale(1.025)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        1000,
        0,
        true,
      );
      animate(
        find(".launch-title"),
        [
          { opacity: 0.62, transform: "translateY(12px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        640,
        120,
        true,
      );
      [
        ".launch-kicker",
        ".launch-welcome",
        ".edition-choices",
        ".edition-summary",
        ".launch-actions",
        ".collection-bar",
      ].forEach((selector, index) =>
        animate(find(selector), [{ opacity: 0.8 }, { opacity: 1 }], 420, 150 + index * 65, true),
      );
    }
    // Low-frequency light folds draw only inside the art layer, below its scrim.
    if (theme === "atmosphere") {
      const art = find(".launcher-art");
      canvas = document.createElement("canvas");
      canvas.className = "atmosphere-folds";
      canvas.setAttribute("aria-hidden", "true");
      art?.append(canvas);
      const context = canvas.getContext("2d");
      if (context) {
        art?.classList.add("atmosphere-ready");
        let last = 0;
        const draw = (time: number) => {
          if (!canvas || !art) return;
          if (time - last > 1000 / 24 || !last) {
            last = time;
            const { width, height } = art.getBoundingClientRect();
            const scale = Math.min(devicePixelRatio || 1, 1.5);
            const w = Math.max(1, Math.round(width * scale)),
              h = Math.max(1, Math.round(height * scale));
            if (canvas.width !== w || canvas.height !== h) {
              canvas.width = w;
              canvas.height = h;
            }
            context.clearRect(0, 0, w, h);
            const t = reduced.matches ? 0 : time / 1000;
            for (let i = 0; i < 6; i++) {
              const x = w * (0.46 + i * 0.095 + Math.sin(t * 0.13 + i * 1.7) * 0.025);
              const light = context.createLinearGradient(x - w * 0.06, 0, x + w * 0.07, h);
              light.addColorStop(0, "#b6413500");
              light.addColorStop(0.5, `rgba(182,65,53,${0.12 + Math.sin(t * 0.1 + i) * 0.035})`);
              light.addColorStop(1, "#b6413500");
              context.fillStyle = light;
              context.fillRect(x - w * 0.08, 0, w * 0.17, h);
            }
          }
          if (!document.hidden && !reduced.matches) frame = requestAnimationFrame(draw);
        };
        const start = () => {
          cancelAnimationFrame(frame);
          frame = 0;
          if (!document.hidden) draw(performance.now());
        };
        const visibility = () => {
          stop();
          start();
        };
        document.addEventListener("visibilitychange", visibility);
        reduced.addEventListener("change", visibility);
        start();
        // Attach cleanup through the same controller as the listeners below.
        cleanupAtmosphere = () => {
          document.removeEventListener("visibilitychange", visibility);
          reduced.removeEventListener("change", visibility);
          art?.classList.remove("atmosphere-ready");
        };
      }
    }
    function visibility() {
      if (theme !== "atmosphere" && (document.hidden || reduced.matches)) {
        stop();
        setFeedback("Ready for your command.");
      }
    }
    host.addEventListener("click", click);
    host.addEventListener("pointerdown", cancelEntrance, { capture: true, passive: true });
    host.addEventListener("keydown", cancelEntrance, true);
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", visibility);
    return () => {
      stop();
      cleanupAtmosphere?.();
      canvas?.remove();
      preview.current = () => {};
      host.removeEventListener("click", click);
      host.removeEventListener("pointerdown", cancelEntrance, true);
      host.removeEventListener("keydown", cancelEntrance, true);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", visibility);
    };
  }, [root, theme]);
  return { feedback, preview: () => preview.current() };
}
