(() => {
  // =========================
  // CONFIG / BASELINES
  // =========================
  const VERSION = "v0.3.1 (world+ground)";

  // World size baseline
  const WORLD_W = 50000;
  const WORLD_H = 5000;

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
    // renderer.js already exists in your setup
    await loadScript("renderer.js");

    // NEW module split
    await loadScript("world.js");
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

    // Create world + tool
    const world = window.World.createWorld({ width: WORLD_W, height: WORLD_H });
    const sketcher = window.Sketcher.createSketcher(world);

    // Camera (world-space top-left + zoom)
    const cam = { x: 0, y: 0, z: 1.0 };

    // Pan state (middle mouse)
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

      // World first (ground + any painted solids)
      world.draw(ctx, cam);

      // Tool preview on top
      sketcher.drawPreview(ctx, cam, worldToScreen);

      // UI last
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
    });

    canvas.addEventListener("mousemove", (e) => {
      const pScreen = getMouseScreen(e);

      if (panning) {
        const dx = pScreen.x - panStartMouse.x;
        const dy = pScreen.y - panStartMouse.y;

        cam.x = panStartCam.x - dx / cam.z;
        cam.y = panStartCam.y - dy / cam.z;

        clampCameraToWorld();
        draw();
        return;
      }

      if (sketcher.isPlacing()) {
        sketcher.updatePlacing(screenToWorld(pScreen));
        draw();
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 1) {
        panning = false;
        draw();
      }
    });

    // Two-click circle placement: click = start, click = finalize
    canvas.addEventListener("click", (e) => {
      if (e.button !== 0) return;
      if (panning) return;

      const pWorld = screenToWorld(getMouseScreen(e));

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
