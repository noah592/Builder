(() => {
  // =========================
  // CONFIG / BASELINES
  // =========================
  const VERSION = "v0.2.0 (2026-01-03)";

  // World size baseline (your new default)
  const WORLD_W = 50000;
  const WORLD_H = 5000;

  // Camera zoom limits
  const MIN_ZOOM_ABS = 0.1; // safety
  const MAX_ZOOM = 8;

  // =========================
  // Loader: keep index.html unchanged
  // =========================
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  async function boot() {
    // Load modules (globals) without touching index.html
    await loadScript("renderer.js");
    await loadScript("sketcher.js");

    startApp();
  }

  // =========================
  // App
  // =========================
  function startApp() {
    const canvas = document.getElementById("c");
    const ctx = canvas.getContext("2d", { alpha: false });

    const renderer = window.Renderer.createRenderer({ version: VERSION });
    const sketcher = window.Sketcher.createSketcher();

    const cam = { x: 0, y: 0, z: 1.0 };

    let panning = false;
    let panStartMouse = { x: 0, y: 0 };
    let panStartCam = { x: 0, y: 0 };

    let didInitCenter = false;

    function clamp(v, a, b) {
      return Math.max(a, Math.min(b, v));
    }

    function getRect() {
      return canvas.getBoundingClientRect();
    }

    function getMouseScreen(e) {
      const r = getRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function worldToScreen(p, camRef = cam) {
      return { x: (p.x - camRef.x) * camRef.z, y: (p.y - camRef.y) * camRef.z };
    }

    function screenToWorld(p, camRef = cam) {
      return { x: camRef.x + p.x / camRef.z, y: camRef.y + p.y / camRef.z };
    }

    function getWorldFitMinZoom() {
      // Enforce: viewport (world units) never exceeds world size
      const rect = getRect();
      const minZx = rect.width / WORLD_W;
      const minZy = rect.height / WORLD_H;
      return Math.max(minZx, minZy);
    }

    function applyZoomLimits() {
      const minFit = getWorldFitMinZoom();
      const effectiveMin = Math.max(MIN_ZOOM_ABS, minFit);
      cam.z = clamp(cam.z, effectiveMin, MAX_ZOOM);
    }

    function getViewWorldSize() {
      const rect = getRect();
      return { w: rect.width / cam.z, h: rect.height / cam.z };
    }

    function centerCamera() {
      applyZoomLimits();
      const view = getViewWorldSize();
      cam.x = (WORLD_W - view.w) / 2;
      cam.y = (WORLD_H - view.h) / 2;
    }

    function clampCameraToWorld() {
      // With zoom limited, view is always <= world, so these are valid.
      const view = getViewWorldSize();
      cam.x = clamp(cam.x, 0, WORLD_W - view.w);
      cam.y = clamp(cam.y, 0, WORLD_H - view.h);
    }

    function resize() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const rect = getRect();

      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (!didInitCenter) {
        centerCamera();
        didInitCenter = true;
      } else {
        applyZoomLimits();
        clampCameraToWorld();
      }

      draw();
    }

    function draw() {
      renderer.beginFrame(ctx, canvas);
      sketcher.draw(ctx, cam, worldToScreen);
      renderer.drawVersion(ctx);
    }

    // Stop middle-click autoscroll icon behavior
    canvas.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });

    canvas.addEventListener("mousedown", (e) => {
      const pScreen = getMouseScreen(e);

      // Middle mouse drag = pan
      if (e.button === 1) {
        e.preventDefault();
        panning = true;
        panStartMouse = pScreen;
        panStartCam = { x: cam.x, y: cam.y };
        return;
      }

      // Left mouse: drag circle if hit (sketcher owns that)
      if (e.button === 0) {
        const pWorld = screenToWorld(pScreen);
        const consumed = sketcher.beginDragIfHit(pWorld, cam.z);
        if (consumed) draw();
      }
    });

    canvas.addEventListener("mousemove", (e) => {
      const pScreen = getMouseScreen(e);
      const pWorld = screenToWorld(pScreen);

      if (panning) {
        const dx = pScreen.x - panStartMouse.x;
        const dy = pScreen.y - panStartMouse.y;

        cam.x = panStartCam.x - dx / cam.z;
        cam.y = panStartCam.y - dy / cam.z;

        clampCameraToWorld();
        draw();
        return;
      }

      if (sketcher.isDragging()) {
        sketcher.updateDrag(pWorld, WORLD_W, WORLD_H);
        draw();
        return;
      }

      if (sketcher.isPlacing()) {
        sketcher.updatePlacing(pWorld);
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
        if (sketcher.isDragging()) {
          sketcher.endDrag();
          draw();
        }
      }
    });

    // Left click to place center / finalize (two-click)
    canvas.addEventListener("click", (e) => {
      if (e.button !== 0) return;
      if (panning) return;
      if (sketcher.isDragging()) return;

      const pWorld = screenToWorld(getMouseScreen(e));

      // If not placing, ignore click if it's on a circle (so dragging is clean)
      if (!sketcher.isPlacing()) {
        const hit = sketcher.hitTestCircleAtWorldPoint(pWorld, cam.z);
        if (hit !== -1) return;

        sketcher.startPlacing(pWorld);
        draw();
        return;
      }

      sketcher.finalizePlacing(pWorld);
      draw();
    });

    // Zoom at cursor (never beyond world fit)
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();

      const pScreen = getMouseScreen(e);
      const before = screenToWorld(pScreen);

      const zoomFactor = Math.exp(-e.deltaY * 0.001);
      cam.z *= zoomFactor;

      applyZoomLimits();

      const after = screenToWorld(pScreen);

      // keep cursor pinned
      cam.x += before.x - after.x;
      cam.y += before.y - after.y;

      clampCameraToWorld();

      // keep preview consistent while zooming
      if (sketcher.isPlacing()) {
        sketcher.updatePlacing(screenToWorld(pScreen));
      }

      draw();
    }, { passive: false });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        sketcher.cancelPlacing();
        sketcher.endDrag();
        panning = false;
        draw();
      }

      if (e.key === "Backspace") {
        e.preventDefault();
        sketcher.undo();
        draw();
      }

      if (e.key.toLowerCase() === "c") {
        centerCamera();
        clampCameraToWorld();
        draw();
      }
    }, { passive: false });

    window.addEventListener("resize", resize);

    resize();
  }

  boot().catch((err) => {
    console.error(err);
    alert(String(err));
  });
})();
