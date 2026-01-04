(() => {
  const VERSION = "v0.0.3 (2026-01-03)";

  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  // Create an on-screen version label from JS (not HTML)
  const ver = document.createElement("div");
  ver.textContent = `RUNNING: ${VERSION}`;
  ver.style.position = "fixed";
  ver.style.left = "10px";
  ver.style.top = "10px";
  ver.style.color = "#fff";
  ver.style.font = "14px system-ui, sans-serif";
  ver.style.zIndex = "9999";
  ver.style.pointerEvents = "none";
  ver.style.userSelect = "none";
  ver.style.opacity = "0.95";
  document.body.appendChild(ver);

  console.log(`RUNNING: ${VERSION}`);

  const circles = []; // {x,y,r}

  let placing = false;
  let center = { x: 0, y: 0 };
  let previewR = 0;

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    // draw using CSS pixel coordinates
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function getMouse(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function clear() {
    const r = canvas.getBoundingClientRect();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, r.width, r.height);
  }

  function drawFinalCircle(c) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill(); // SOLID
    ctx.restore();
  }

  function drawPreviewCircle(x, y, r) {
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke(); // outline only
    ctx.restore();
  }

  function drawCenterDot(x, y) {
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawVersionStampAndTestDot() {
    // Version text drawn on the CANVAS too (in case overlay is blocked)
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(`RUNNING: ${VERSION}`, 10, 32);

    // A guaranteed solid fill test marker:
    // If you see this as hollow, then fill is not being applied somehow.
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(22, 58, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("FILL TEST DOT", 40, 50);
    ctx.restore();
  }

  function draw() {
    clear();

    // finalized circles should be FILLED
    for (const c of circles) drawFinalCircle(c);

    // preview should be OUTLINE
    if (placing) {
      drawCenterDot(center.x, center.y);
      drawPreviewCircle(center.x, center.y, previewR);
    }

    drawVersionStampAndTestDot();
  }

  canvas.addEventListener("click", (e) => {
    const p = getMouse(e);

    if (!placing) {
      placing = true;
      center = p;
      previewR = 0;
      draw();
      return;
    }

    const r = Math.hypot(p.x - center.x, p.y - center.y);
    if (r > 1) circles.push({ x: center.x, y: center.y, r });

    placing = false;
    previewR = 0;
    draw();
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!placing) return;
    const p = getMouse(e);
    previewR = Math.hypot(p.x - center.x, p.y - center.y);
    draw();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      placing = false;
      previewR = 0;
      draw();
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      circles.pop();
      draw();
    }
  }, { passive: false });

  window.addEventListener("resize", resize);
  resize();
})();
