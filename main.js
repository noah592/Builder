(() => {
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  // Stored circles
  /** @type {{x:number,y:number,r:number}[]} */
  const circles = [];

  // In-progress circle state
  let isPlacing = false;
  let center = { x: 0, y: 0 };
  let currentR = 0;

  function resizeCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // Use CSS pixels for drawing
      ctx.scale(dpr, dpr);
    }
    draw();
  }

  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function clear() {
    // Because alpha:false, this is a fast solid clear
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  }

  function drawCircle(x, y, r, opts = {}) {
    const { dashed = false, alpha = 1 } = opts;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    if (dashed) ctx.setLineDash([6, 6]);

    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
    ctx.stroke();
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

  function draw() {
    clear();

    // Draw stored circles
    for (const c of circles) {
      drawCircle(c.x, c.y, c.r);
    }

    // Draw preview
    if (isPlacing) {
      drawCenterDot(center.x, center.y);
      drawCircle(center.x, center.y, currentR, { dashed: true, alpha: 0.9 });
    }
  }

  // Input
  canvas.addEventListener("click", (e) => {
    const p = getMousePos(e);

    if (!isPlacing) {
      // First click: set center
      isPlacing = true;
      center = p;
      currentR = 0;
      draw();
      return;
    }

    // Second click: finalize circle
    const r = dist(center, p);
    if (r > 0.5) {
      circles.push({ x: center.x, y: center.y, r });
    }
    isPlacing = false;
    currentR = 0;
    draw();
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!isPlacing) return;
    const p = getMousePos(e);
    currentR = dist(center, p);
    draw();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (isPlacing) {
        isPlacing = false;
        currentR = 0;
        draw();
      }
    }

    if (e.key === "Backspace") {
      // prevent browser navigation
      e.preventDefault();
      circles.pop();
      draw();
    }
  }, { passive: false });

  window.addEventListener("resize", resizeCanvas);

  // Init
  resizeCanvas();
})();
