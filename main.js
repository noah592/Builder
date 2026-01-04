(() => {
  // =========================
  // CONFIG
  // =========================
  const VERSION = "v0.1.3 (2026-01-03)";

  // World size (world units)
  const WORLD_W = 3000;
  const WORLD_H = 2000;

  // Interaction tuning
  const HIT_PAD_PX = 6;
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 8;

  // If true, the camera will re-center on resize when the viewport becomes larger than the world.
  // (It already recenters in that case regardless; this just keeps behavior stable.)
  const RECENTER_WHEN_VIEW_BIGGER_THAN_WORLD = true;

  // =========================
  // SETUP
  // =========================
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  const cam = {
    x: 0,
    y: 0,
    z: 1.0, // starting zoom
  };

  // circles stored in WORLD coords
  const circles = []; // {x,y,r}

  // New circle placement (two-click)
  let placing = false;
  let placeCenter = { x: 0, y: 0 };
  let placeR = 0;

  // Drag existing circle (left mouse)
  let draggingCircle = false;
  let dragIndex = -1;
  let dragOffset = { x: 0, y: 0 };

  // Pan camera (middle mouse drag)
  let panning = false;
  let panStartMouse = { x: 0, y: 0 };
  let panStartCam = { x: 0, y: 0 };

  let lastMouseScreen = { x: 0, y: 0 };

  // One-time init so we center the camera on first resize
  let didInitCenter = false;

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function getViewSizeWorld() {
    const rect = canvas.getBoundingClientRect();
    return {
      w: rect.width / cam.z,
      h: rect.height / cam.z,
      rect,
    };
  }

  function centerCameraInWorld() {
    const { w: viewW, h: viewH } = getViewSizeWorld();
    cam.x = (WORLD_W - viewW) / 2;
    cam.y = (WORLD_H - viewH) / 2;
  }

  function clampCameraToWorld() {
    const { w: viewW, h: viewH } = getViewSizeWorld();

    // If the view is smaller than the world, allow full travel across world extents.
    // If the view is larger than the world, lock camera to centered position so it doesn't feel "stuck".
    if (viewW <= WORLD_W) {
      cam.x = clamp(cam.x, 0, WORLD_W - viewW);
    } else if (RECENTER_WHEN_VIEW_BIGGER_THAN_WORLD) {
      cam.x = (WORLD_W - viewW) / 2;
    }

    if (viewH <= WORLD_H) {
      cam.y = clamp(cam.y, 0, WORLD_H - viewH);
    } else if (RECENTER_WHEN_VIEW_BIGGER_THAN_WORLD) {
      cam.y = (WORLD_H - viewH) / 2;
    }
  }

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    // Draw in CSS pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Center on first load (after we know viewport size)
    if (!didInitCenter) {
      centerCameraInWorld();
      didInitCenter = true;
    } else {
      // Keep camera valid after resizing
      clampCameraToWorld();
    }

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

  // =========================
  // INPUT
  // =========================

  // Stop middle-click autoscroll
  canvas.addEventListener("auxclick", (e) => {
    if (e.button === 1) e.preventDefault();
  });

  canvas.addEventListener("mousedown", (e) => {
    const p = getMouseScreen(e);
    lastMouseScreen = p;

    // Middle mouse drag = pan
    if (e.button === 1) {
      e.preventDefault();
      panning = true;
      panStartMouse = p;
      panStartCam = { x: cam.x, y: cam.y };
      return;
    }

    // Left mouse = drag circle (if hit)
    if (e.button !== 0) return;
    if (placing) return;

    const hit = findCircleAtScreenPoint(p);
    if (hit !== -1) {
      draggingCircle = true;

      // bring to top visually
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

      // Optional: keep circles within the world bounds
      c.x = clamp(c.x, 0, WORLD_W);
      c.y = clamp(c.y, 0, WORLD_H);

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

  // Left click to place center / finalize
  canvas.addEventListener("click", (e) => {
    if (panning || draggingCircle) return;
    if (e.button !== 0) return;

    const p = getMouseScreen(e);

    // If clicking a circle while not placing, do nothing
    if (!placing) {
      const hit = findCircleAtScreenPoint(p);
      if (hit !== -1) return;

      placing = true;
      placeCenter = screenToWorld(p);
      placeR = 0;
      draw();
      return;
    }

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

    // keep cursor pinned to the same world point
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

    // Optional: press "C" to re-center camera anytime
    if (e.key.toLowerCase() === "c") {
      centerCameraInWorld();
      clampCameraToWorld();
      draw();
    }
  }, { passive: false });

  window.addEventListener("resize", resize);

  // Init
  resize();
})();
