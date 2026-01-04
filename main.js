(() => {
  // =========================
  // CONFIG
  // =========================
  const VERSION = "v0.1.0 (2026-01-03)";

  // Changeable "world" size (in world units / pixels)
  // This does NOT change the starting zoom (starts at 1.0).
  const WORLD_W = 3000;
  const WORLD_H = 2000;

  // Interaction tuning
  const HIT_PAD_PX = 6;          // extra hit padding in screen pixels
  const PAN_DRAG_THRESHOLD = 4;  // pixels of movement before we treat it as a pan (vs a click)
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 8;

  // =========================
  // SETUP
  // =========================
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  // Camera: top-left of viewport in world coords + zoom
  const cam = {
    x: 0,
    y: 0,
    z: 1.0, // starting zoom stays the same as before
  };

  // Circles stored in WORLD coords
  const circles = []; // {x,y,r}

  // Draw-new-circle state (two-click)
  let placing = false;
  let placeCenter = { x: 0, y: 0 };
  let placeR = 0;

  // Drag circle state
  let draggingCircle = false;
  let dragIndex = -1;
  let dragOffset = { x: 0, y: 0 };

  // Pan state (click-drag on empty space)
  let panning = false;
  let panCandidate = false;
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

    // We'll draw in CSS pixels; scale the backing store via transform.
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

  function drawWorldBounds() {
    // optional subtle border so you can "feel" world size (comment out if you don’t want it)
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

  function draw() {
    clear();

    // World bounds (dashed)
    drawWorldBounds();

    // Final circles (filled)
    for (const c of circles) {
      drawFilledCircleWorld(c.x, c.y, c.r);
    }

    // Preview (outline only)
    if (placing) {
      drawCenterDotWorld(placeCenter.x, placeCenter.y);
      drawPreviewCircleWorld(placeCenter.x, placeCenter.y, placeR);
    }

    // Version label (single)
    drawVersion();
  }

  function findCircleAtScreenPoint(pScreen) {
    // test from topmost (last drawn) to bottom
    const pWorld = screenToWorld(pScreen);

    for (let i = circles.length - 1; i >= 0; i--) {
      const c = circles[i];
      const dx = pWorld.x - c.x;
      const dy = pWorld.y - c.y;
      const d = Math.hypot(dx, dy);

      // padding in screen pixels converted to world units
      const padWorld = HIT_PAD_PX / cam.z;

      if (d <= c.r + padWorld) return i;
    }
    return -1;
  }

  function clampCameraToWorld() {
    // Keep camera reasonably within the world (allow a little overscroll)
    const rect = canvas.getBoundingClientRect();
    const viewW = rect.width / cam.z;
    const viewH = rect.height / cam.z;

    const margin = 200 / cam.z; // world-units margin depending on zoom

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
  canvas.addEventListener("mousedown", (e) => {
    const p = getMouseScreen(e);
    lastMouseScreen = p;

    // Only left mouse for interactions
    if (e.button !== 0) return;

    // If we are mid-placement, ignore drag/pan/circle drag until the second click
    if (placing) return;

    const hit = findCircleAtScreenPoint(p);
    if (hit !== -1) {
      // Start dragging this circle
      draggingCircle = true;
      dragIndex = hit;

      const w = screenToWorld(p);
      dragOffset.x = circles[hit].x - w.x;
      dragOffset.y = circles[hit].y - w.y;

      // bring to top visually by moving to end
      const picked = circles.splice(hit, 1)[0];
      circles.push(picked);
      dragIndex = circles.length - 1;

      draw();
      return;
    }

    // Not on a circle: candidate for panning OR (if no drag) a click-to-place center.
    panCandidate = true;
    panning = false;
    panStartMouse = p;
    panStartCam = { x: cam.x, y: cam.y };
  });

  canvas.addEventListener("mousemove", (e) => {
    const p = getMouseScreen(e);
    lastMouseScreen = p;

    if (draggingCircle) {
      const w = screenToWorld(p);
      const c = circles[dragIndex];
      c.x = w.x + dragOffset.x;
      c.y = w.y + dragOffset.y;
      draw();
      return;
    }

    if (panCandidate) {
      const dx = p.x - panStartMouse.x;
      const dy = p.y - panStartMouse.y;
      const moved = Math.hypot(dx, dy);

      if (!panning && moved >= PAN_DRAG_THRESHOLD) {
        panning = true;
      }

      if (panning) {
        cam.x = panStartCam.x - dx / cam.z;
        cam.y = panStartCam.y - dy / cam.z;
        clampCameraToWorld();
        draw();
      }
      return;
    }

    if (placing) {
      const w = screenToWorld(p);
      placeR = Math.hypot(w.x - placeCenter.x, w.y - placeCenter.y);
      draw();
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (e.button !== 0) return;

    if (draggingCircle) {
      draggingCircle = false;
      dragIndex = -1;
      draw();
      return;
    }

    if (panCandidate) {
      // If we never actually started panning, treat this as a click on empty space:
      // start placement (first click behavior).
      if (!panning) {
        const w = screenToWorld(lastMouseScreen);
        placing = true;
        placeCenter = w;
        placeR = 0;
      }

      panCandidate = false;
      panning = false;
      draw();
    }
  });

  // Second click to finalize the circle (keeps your original behavior)
  canvas.addEventListener("click", (e) => {
    // If we were panning or dragging, ignore click events that fire after mouseup
    if (panning || draggingCircle) return;

    const p = getMouseScreen(e);

    if (!placing) return; // first click is handled by mouseup "click on empty space"

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

    // World point under cursor BEFORE zoom
    const before = screenToWorld(p);

    // Smooth zoom factor
    const zoomFactor = Math.exp(-e.deltaY * 0.001);
    cam.z = clamp(cam.z * zoomFactor, MIN_ZOOM, MAX_ZOOM);

    // World point under cursor AFTER zoom
    const after = screenToWorld(p);

    // Adjust camera so the cursor stays pinned to the same world point
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;

    clampCameraToWorld();

    // Update preview radius if placing
    if (placing) {
      const w = screenToWorld(p);
      placeR = Math.hypot(w.x - placeCenter.x, w.y - placeCenter.y);
    }

    draw();
  }, { passive: false });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // cancel in-progress placement OR stop pan candidates
      placing = false;
      placeR = 0;
      panCandidate = false;
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
