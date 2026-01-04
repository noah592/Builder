(() => {
  // =========================================================
  // CONFIG
  // =========================================================
  const WORLD_W = 50000;
  const WORLD_H = 5000;

  const VERSION = "v0.9.0";

  const MIN_ZOOM = 0.02;
  const MAX_ZOOM = 10;

  // =========================================================
  // CANVAS & CONTEXT
  // =========================================================
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // LOCKED BASELINE
    ctx.imageSmoothingEnabled = false;
  }

  window.addEventListener("resize", resize);
  resize();

  // =========================================================
  // CAMERA
  // =========================================================
  const cam = {
    x: 0,
    y: 0,
    z: 1,
  };

  function centerCamera() {
    const viewW = canvas.width / cam.z;
    const viewH = canvas.height / cam.z;

    cam.x = (WORLD_W - viewW) / 2;
    cam.y = (WORLD_H - viewH) / 2;
  }

  centerCamera();

  function clampZoom(z) {
    const maxZoomX = canvas.width / WORLD_W;
    const maxZoomY = canvas.height / WORLD_H;
    const minZoom = Math.min(maxZoomX, maxZoomY);

    return Math.max(minZoom, Math.min(MAX_ZOOM, z));
  }

  // =========================================================
  // COORDINATE HELPERS
  // =========================================================
  function screenToWorld(pt) {
    return {
      x: cam.x + pt.x / cam.z,
      y: cam.y + pt.y / cam.z,
    };
  }

  function worldToScreen(pt) {
    return {
      x: (pt.x - cam.x) * cam.z,
      y: (pt.y - cam.y) * cam.z,
    };
  }

  // =========================================================
  // LOAD MODULES
  // =========================================================
  const world = window.World.createWorld({
    width: WORLD_W,
    height: WORLD_H,
  });

  const sketcher = window.Sketcher.createSketcher(world);

  // =========================================================
  // INPUT STATE
  // =========================================================
  let isPanning = false;
  let lastMouse = { x: 0, y: 0 };

  // =========================================================
  // MOUSE EVENTS
  // =========================================================
  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouse = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    lastMouse = mouse;

    if (e.button === 1) {
      // Middle mouse: pan
      isPanning = true;
      e.preventDefault();
      return;
    }

    if (e.button === 0) {
      // Left mouse: sketch
      const worldPt = screenToWorld(mouse);

      if (!sketcher.isPlacing()) {
        sketcher.startPlacing(worldPt);
      } else {
        sketcher.finalizePlacing(worldPt);
      }
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouse = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    const dx = mouse.x - lastMouse.x;
    const dy = mouse.y - lastMouse.y;
    lastMouse = mouse;

    if (isPanning) {
      cam.x -= dx / cam.z;
      cam.y -= dy / cam.z;
      return;
    }

    if (sketcher.isPlacing()) {
      sketcher.updatePlacing(screenToWorld(mouse));
    }
  });

  canvas.addEventListener("mouseup", (e) => {
    if (e.button === 1) {
      isPanning = false;
    }
  });

  canvas.addEventListener("mouseleave", () => {
    isPanning = false;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mouse = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    const before = screenToWorld(mouse);

    const zoomFactor = Math.exp(-e.deltaY * 0.001);
    const requestedZoom = cam.z * zoomFactor;
    const appliedZoom = clampZoom(requestedZoom);

    const zoomAppliedFactor = appliedZoom / cam.z;
    cam.z = appliedZoom;

    const after = screenToWorld(mouse);

    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  }, { passive: false });

  // =========================================================
  // RENDER LOOP
  // =========================================================
  function drawVersion() {
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.font = "12px monospace";
    ctx.fillText(VERSION, 10, 16);
    ctx.restore();
  }

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // WORLD FIRST
    world.draw(ctx, cam);

    // TOOL PREVIEW
    sketcher.drawPreview(ctx, cam, worldToScreen);

    // UI
    drawVersion();

    requestAnimationFrame(frame);
  }

  frame();
})();
