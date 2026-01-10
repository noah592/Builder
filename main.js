(() => {
  // =========================
  // CONFIG / BASELINES
  // =========================
  const VERSION = "v0.4.0 (bodies module)";

  // World size baseline
  const WORLD_W = 500000;
  const WORLD_H = 50000;

  // Camera zoom limits
  const MIN_ZOOM_ABS = 0.02; // safety floor
  const MAX_ZOOM = 10;

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
    await loadScript("renderer.js");
    await loadScript("world.js");
    await loadScript("bodies.js");
    await loadScript("sketcher.js");
    startApp();
  }

  // =========================
  // App
  // =========================
  function startApp() {
    const canvas = document.getElementById("c");
    if (!canvas) {
      alert('Canvas element not found. Expected id="c".');
      return;
    }

    const ctx = canvas.getContext("2d", { alpha: false });

    const renderer = window.Renderer.createRenderer({ version: VERSION });
    const world = window.World.createWorld({ width: WORLD_W, height: WORLD_H });
    const bodies = window.Bodies.createBodies();
    const sketcher = window.Sketcher.createSketcher(bodies);

    const cam = { x: 0, y: 0, z: 1.0 };

    // Middle mouse pan
    let panning = false;
    let panStartMouse = { x: 0, y: 0 };
    let panStartCam = { x: 0, y: -11000 };

    // Left mouse drag body
    let draggingBody = false;
    let dragBodyId = -1;
    let dragOffset = { x: 0, y: 0 };
    let suppressNextClick = false;

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

    function screenToWorld(p, camRef = cam) {
      return { x: camRef.x + p.x / camRef.z, y: camRef.y + p.y / camRef.z };
    }

    function worldToScreen(p, camRef = cam) {
      return { x: (p.x - camRef.x) * camRef.z, y: (p.y - camRef.y) * camRef.z };
    }

    function getWorldFitMinZoom() {
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

      // LOCKED BASELINE: crisp pixels
      ctx.imageSmoothingEnabled = false;

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

      // 1) Static world (implicit ground + overrides)
      world.draw(ctx, cam);

      // 2) Dynamic bodies
      bodies.draw(ctx, cam);

      // 3) Tool preview
      sketcher.drawPreview(ctx, cam, worldToScreen);

      // 4) UI
      renderer.drawVersion(ctx);
    }

    // Prevent middle-click autoscroll icon
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

      // Left mouse down: try to start dragging a body (only if not placing)
      if (e.button === 0 && !sketcher.isPlacing()) {
        const pWorld = screenToWorld(pScreen);
        const id = bodies.hitTest(pWorld);
        if (id !== -1) {
          const pos = bodies.getBodyPos(id);
          if (pos) {
            draggingBody = true;
            dragBodyId = id;
            dragOffset = { x: pWorld.x - pos.x, y: pWorld.y - pos.y };
            suppressNextClick = true; // suppress click after drag
            draw();
            return;
          }
        }
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

      if (draggingBody) {
        // Move body in world space (translation only)
        const newX = pWorld.x - dragOffset.x;
        const newY = pWorld.y - dragOffset.y;
        bodies.setBodyPos(dragBodyId, newX, newY);
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
        if (draggingBody) {
          draggingBody = false;
          dragBodyId = -1;
          dragOffset = { x: 0, y: 0 };
          draw();
        }
      }
    });

    // Two-click placement (click = start, click = finalize)
    canvas.addEventListener("click", (e) => {
      if (e.button !== 0) return;
      if (panning) return;

      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }

      const pWorld = screenToWorld(getMouseScreen(e));

      // If click lands on a body and we're not placing, do nothing
      // (dragging uses mousedown+move)
      if (!sketcher.isPlacing()) {
        const hit = bodies.hitTest(pWorld);
        if (hit !== -1) return;
      }

      if (!sketcher.isPlacing()) {
        sketcher.startPlacing(pWorld);
      } else {
        sketcher.finalizePlacing(pWorld);
      }

      draw();
    });

    // Zoom at cursor (applied zoom math)
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();

        const pScreen = getMouseScreen(e);
        const before = screenToWorld(pScreen);

        const z0 = cam.z;
        const zoomFactor = Math.exp(-e.deltaY * 0.001);

        cam.z = z0 * zoomFactor;
        applyZoomLimits();

        const z1 = cam.z;
        const applied = z1 / z0;

        if (applied !== 1) {
          cam.x = before.x - pScreen.x / z1;
          cam.y = before.y - pScreen.y / z1;
        }

        clampCameraToWorld();

        if (sketcher.isPlacing()) {
          sketcher.updatePlacing(screenToWorld(pScreen));
        }

        draw();
      },
      { passive: false }
    );

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        sketcher.cancelPlacing();
        panning = false;
        draggingBody = false;
        dragBodyId = -1;
        suppressNextClick = false;
        draw();
      }

      if (e.key.toLowerCase() === "c") {
        centerCamera();
        clampCameraToWorld();
        draw();
      }
    });

    window.addEventListener("resize", resize);

    resize();
  }

  boot().catch((err) => {
    console.error(err);
    alert(String(err));
  });
})();
