/* Canvas light curtains, with no input listeners or foreground mutation. */
(() => {
  const art = document.querySelector(".launcher-art");
  if (!art) return;
  const canvas = document.createElement("canvas");
  canvas.className = "atmosphere-folds";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return; // CSS keeps a static atmosphere if canvas is unavailable.
  art.append(canvas);
  art.classList.add("atmosphere-ready");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const accent = getComputedStyle(art)
    .getPropertyValue("--color-launcher-red")
    .trim();
  const hex = /^#([a-f\d]{6})$/i.exec(accent)?.[1] || "b64135";
  const rgb = [0, 2, 4]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
    .join(",");
  const folds = [
    [0.47, 0.06, 0.16, 0.2],
    [0.56, 0.09, 0.26, 1.8],
    [0.66, 0.055, 0.18, 3.2],
    [0.73, 0.1, 0.32, 4.3],
    [0.83, 0.07, 0.27, 0.9],
    [0.94, 0.11, 0.22, 2.7],
  ];
  let width = 1,
    height = 1,
    raf = 0,
    last = 0,
    elapsed = 0;
  const rgba = (alpha) => `rgba(${rgb},${alpha})`;
  function draw(seconds) {
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "screen";
    for (const [position, spread, strength, phase] of folds) {
      const drift = Math.sin(seconds * 0.075 + phase) * width * 0.025;
      const x = width * position + drift;
      const half = width * spread;
      const bend = Math.sin(seconds * 0.052 + phase) * width * 0.038;
      const gradient = ctx.createLinearGradient(x - half, 0, x + half, 0);
      const modulation = 0.9 + Math.sin(seconds * 0.06 + phase) * 0.1;
      gradient.addColorStop(0, rgba(0));
      gradient.addColorStop(0.35, rgba(strength * modulation * 0.24));
      gradient.addColorStop(0.57, rgba(strength * modulation));
      gradient.addColorStop(0.76, rgba(strength * modulation * 0.35));
      gradient.addColorStop(1, rgba(0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(x - half, -height * 0.15);
      ctx.bezierCurveTo(
        x - half + bend,
        height * 0.25,
        x - half - bend,
        height * 0.75,
        x - half * 0.7,
        height,
      );
      ctx.lineTo(x + half * 0.85, height);
      ctx.bezierCurveTo(
        x + half - bend,
        height * 0.7,
        x + half + bend,
        height * 0.25,
        x + half,
        -height * 0.15,
      );
      ctx.closePath();
      ctx.fill();
    }
    // All folds taper out at the top and gather softly along the lower edge.
    ctx.globalCompositeOperation = "destination-in";
    const falloff = ctx.createLinearGradient(0, 0, 0, height);
    falloff.addColorStop(0, "rgba(0,0,0,0)");
    falloff.addColorStop(0.35, "rgba(0,0,0,0.23)");
    falloff.addColorStop(1, "rgba(0,0,0,0.95)");
    ctx.fillStyle = falloff;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "screen";
    const bloom = ctx.createRadialGradient(
      width * 0.91,
      height * 0.91,
      0,
      width * 0.91,
      height * 0.91,
      Math.max(width, height) * 0.53,
    );
    bloom.addColorStop(0, rgba(0.25));
    bloom.addColorStop(0.4, rgba(0.08));
    bloom.addColorStop(1, rgba(0));
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, width, height);
  }
  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!document.hidden) draw(reduced.matches ? 0 : elapsed);
  }
  function tick(now) {
    raf = 0;
    if (document.hidden || reduced.matches) return;
    if (!last || now - last >= 1000 / 24) {
      elapsed += last ? Math.min(now - last, 100) / 1000 : 0;
      last = now;
      draw(elapsed);
    }
    raf = requestAnimationFrame(tick);
  }
  function synchronize() {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (document.hidden) return;
    draw(reduced.matches ? 0 : elapsed);
    if (!reduced.matches) raf = requestAnimationFrame(tick);
  }
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", synchronize);
  reduced.addEventListener("change", synchronize);
  document.addEventListener("comparison:replay", () => {
    elapsed = 0;
    synchronize();
  });
  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(raf);
    raf = 0;
  });
  window.addEventListener("pageshow", synchronize);
  resize();
  synchronize();
})();
