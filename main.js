(() => {
  // =========================
  // CONFIG
  // =========================
  const VERSION = "v0.1.1 (2026-01-03)";

  // World size (world units)
  const WORLD_W = 3000;
  const WORLD_H = 2000;

  // Interaction tuning
  const HIT_PAD_PX = 6;     // extra hit padding in screen px
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 8;

  // =========================
  // SETUP
  // =========================
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  const cam = {
    x: 0,
    y: 0,
    z: 1.0, // starting zoom stays the same
  };

  // circles are stored in WORLD coords
  const circles = []; // {x,y,r}

  // New circle placement (two-click)
  let placing = false;
  let placeCenter = { x: 0, y: 0 };
  let placeR = 0;

  // Drag existing circle (left mouse)
  let draggingCircle = false;
  let dragIndex = -1;
  let dragOffset = { x: 0, y: 0 };

  // Pan camera (MIDDLE mouse)
  let panning = false;
  let panStartMouse = { x: 0, y: 0 };
  let panStartCam = { x: 0, y: 0 };

  // Track last mouse for preview updates
  let lastMouseScreen = { x: 0, y: 0 };

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    // Draw in CSS pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function getMouseScreen(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function screenToWorld(p) {
    return { x: cam.x + p.x / cam.z, y: cam.y + p.y / cam.z };
  }

  function worldToScreen(p) {
    return { x: (p.x - cam.x) * cam.z, y: (p.y - cam.y) * cam.z };
  }

  function clear() {
    const r = canvas.getBoundingClientRect();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, r.width, r.height);
  }

  function drawVersion() {
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.font = "14px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(`RUNNING: ${VERSION}`, 10, 10);
    ctx.restore();
  }

  function drawWorldBounds() {
    const tl = worldToScreen({ x: 0, y: 0 });
    const br = worldToScreen({ x: WORLD_W, y: WORLD_H });
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.restore();
  }

  function drawFilledCircleWorld(x, y, r) {
    const s = worldToScreen({ x, y });
    const sr = r * cam.z;

    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(0, sr), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPreviewCircleWorld(x, y, r) {
    const s = worldToScreen({ x, y });
    const sr = r * cam.z;

    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(0, sr), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCenterDotWorld(x, y) {
    const s = worldToScreen({ x, y });
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    clear();

    drawWorldBounds();

    for (const c of circles) {
      drawFilledCircleWorld(c.x, c.y, c.r);
    }

    if (placing) {
      drawCenterDotWorld(placeCenter.x, placeCenter.y);
      drawPreviewCircleWorld(placeCenter.x, placeCenter.y, placeR);
    }

    drawVersion();
  }

  function findCircleAtScreenPoint(pScreen) {
    const pWorld = screenToWorld(pScreen);

    for (let i = circles.length - 1; i >= 0; i--) {
      const c = circles[i];
      const dx = pWorld.x - c.x;
      const dy = pWorld.y - c.y;
      const d = Math.hypot(dx, dy);

      const padWorld = HIT_PAD_PX / cam.z;
      if (d <= c.r + padWorld) return i;
    }
    return -1;
  }

  function clampCameraToWorld() {
    const rect = canvas.getBoundingClientRect();
    const viewW = rect.width / cam.z;
    const viewH = rect.height / cam.z;

    const margin = 200 / cam.z;

    const minX = -margin;
    const minY = -margin;
    const maxX = WORLD_W - viewW + margin;
    const maxY = WORLD_H - viewH + margin;

    cam.x = clamp(cam.x, minX, maxX);
    cam.y = clamp(cam.y, minY, maxY);
  }

  // =========================
  // INPUT
  // =========================

  // Prevent middle-click auto-scroll / weirdness
  canvas.addEventListener("auxclick", (e) => {
    // auxclick fires for middle/right; prevent browser behavior
    if (e.button === 1) e.preventDefault();
  });

  canvas.addEventListener("mousedown", (e) => {
    const p = getMouseScreen(e);
    lastMouseScreen = p;

    // MIDDLE mouse drag = PAN
    if (e.button === 1) {
      e.preventDefault();
      panning = true;
      panStartMouse = p;
      panStartCam = { x: cam.x, y: cam.y };
      return;
    }

    // LEFT mouse interactions
    if (e.button !== 0) return;

    // If we're mid placement, ignore mousedown dragging logic
    if (placing) return;

    // Click on circle -> drag it
    const hit = findCircleAtScreenPoint(p);
    if (hit !== -1) {
      draggingCircle = true;

      // bring to top by moving to end
      const picked = circles.splice(hit, 1)[0];
      circles.push(picked);
      dragIndex = circles.length - 1;

      const w = screenToWorld(p);
      dragOffset.x = circles[dragIndex].x - w.x;
      dragOffset.y = circles[dragIndex].y - w.y;

      draw();
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    const p = getMouseScreen(e);
    lastMouseScreen = p;

    if (panning) {
      const dx = p.x - panStartMouse.x;
      const dy = p.y - panStartMouse.y;
      cam.x = panStartCam.x - dx / cam.z;
      cam.y = panStartCam.y - dy / cam.z;
      clampCameraToWorld();
      draw();
      return;
    }

    if (draggingCircle) {
      const w = screenToWorld(p);
      const c = circles[dragIndex];
      c.x = w.x + dragOffset.x;
      c.y = w.y + dragOffset.y;
      draw();
      return;
    }

    if (placing) {
      const w = screenToWorld(p);
      placeR = Math.hypot(w.x - placeCenter.x, w.y - placeCenter.y);
      draw();
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (e.button === 1) {
      panning = false;
      draw();
      return;
    }

    if (e.button === 0) {
      if (draggingCircle) {
        draggingCircle = false;
        dragIndex = -1;
        draw();
      }
    }
  });

  // LEFT click to place circle center / finalize
  canvas.addEventListener("click", (e) => {
    // Ignore clicks that happen at end of a drag-pan or drag-circle
    if (panning || draggingCircle) return;
    if (e.button !== 0) return;

    const p = getMouseScreen(e);

    // If clicking on a circle and not currently placing, don't start placing
    // (This avoids accidental place-start when you meant to select a circle.)
    if (!placing) {
      const hit = findCircleAtScreenPoint(p);
      if (hit !== -1) return;

      // First click: set center
      placing = true;
      placeCenter = screenToWorld(p);
      placeR = 0;
      draw();
      return;
    }

    // Second click: finalize
    const w = screenToWorld(p);
    const r = Math.hypot(w.x - placeCenter.x, w.y - placeCenter.y);
    if (r > 1) circles.push({ x: placeCenter.x, y: placeCenter.y, r });

    placing = false;
    placeR = 0;
    draw();
  });

  // Zoom at cursor
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();

    const p = getMouseScreen(e);
    const before = screenToWorld(p);

    const zoomFactor = Math.exp(-e.deltaY * 0.001);
    cam.z = clamp(cam.z * zoomFactor, MIN_ZOOM, MAX_ZOOM);

    const after = screenToWorld(p);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;

    clampCameraToWorld();

    // keep preview consistent
    if (placing) {
      const w = screenToWorld(p);
      placeR = Math.hypot(w.x - placeCenter.x, w.y - placeCenter.y);
    }

    draw();
  }, { passive: false });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      placing = false;
      placeR = 0;
      draggingCircle = false;
      dragIndex = -1;
      panning = false;
      draw();
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      circles.pop();
      draw();
    }
  }, { passive: false });

  window.addEventListener("resize", resize);

  // Init
  resize();
})();
