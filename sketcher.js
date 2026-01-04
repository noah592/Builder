(() => {
  function createSketcher() {
    // Stored shapes (world coords). For now: circles only.
    const circles = []; // {x,y,r}

    // Placement state (two-click)
    let placing = false;
    let placeCenter = { x: 0, y: 0 };
    let placeR = 0;

    // Drag state (left mouse)
    let dragging = false;
    let dragIndex = -1;
    let dragOffset = { x: 0, y: 0 };

    // Config
    const HIT_PAD_PX = 6;

    function isPlacing() { return placing; }
    function isDragging() { return dragging; }

    function _padWorld(camZ) {
      return HIT_PAD_PX / camZ;
    }

    function hitTestCircleAtWorldPoint(worldPt, camZ) {
      // Topmost first (last drawn)
      const pad = _padWorld(camZ);
      for (let i = circles.length - 1; i >= 0; i--) {
        const c = circles[i];
        const d = Math.hypot(worldPt.x - c.x, worldPt.y - c.y);
        if (d <= c.r + pad) return i;
      }
      return -1;
    }

    function startPlacing(worldPt) {
      placing = true;
      placeCenter = { x: worldPt.x, y: worldPt.y };
      placeR = 0;
    }

    function updatePlacing(worldPt) {
      if (!placing) return;
      placeR = Math.hypot(worldPt.x - placeCenter.x, worldPt.y - placeCenter.y);
    }

    function finalizePlacing(worldPt) {
      if (!placing) return false;
      const r = Math.hypot(worldPt.x - placeCenter.x, worldPt.y - placeCenter.y);
      if (r > 1) circles.push({ x: placeCenter.x, y: placeCenter.y, r });
      placing = false;
      placeR = 0;
      return true;
    }

    function cancelPlacing() {
      placing = false;
      placeR = 0;
    }

    function undo() {
      circles.pop();
    }

    function beginDragIfHit(worldPt, camZ) {
      if (placing) return false;

      const hit = hitTestCircleAtWorldPoint(worldPt, camZ);
      if (hit === -1) return false;

      // bring to top
      const picked = circles.splice(hit, 1)[0];
      circles.push(picked);
      dragIndex = circles.length - 1;

      dragging = true;
      dragOffset.x = circles[dragIndex].x - worldPt.x;
      dragOffset.y = circles[dragIndex].y - worldPt.y;
      return true;
    }

    function updateDrag(worldPt, worldW, worldH) {
      if (!dragging) return;

      const c = circles[dragIndex];
      c.x = worldPt.x + dragOffset.x;
      c.y = worldPt.y + dragOffset.y;

      // Keep circle centers within world bounds (simple clamp)
      c.x = Math.max(0, Math.min(worldW, c.x));
      c.y = Math.max(0, Math.min(worldH, c.y));
    }

    function endDrag() {
      dragging = false;
      dragIndex = -1;
    }

    // -------------------------
    // Drawing
    // -------------------------
    function draw(ctx, cam, worldToScreen) {
      // Final circles (filled)
      for (const c of circles) {
        const s = worldToScreen({ x: c.x, y: c.y }, cam);
        const sr = c.r * cam.z;

        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(0, sr), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Preview (outline)
      if (placing) {
        const s = worldToScreen(placeCenter, cam);
        const sr = placeR * cam.z;

        // center dot
        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // dashed outline
        ctx.save();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(0, sr), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    return {
      // state queries
      isPlacing,
      isDragging,

      // interactions
      hitTestCircleAtWorldPoint,
      startPlacing,
      updatePlacing,
      finalizePlacing,
      cancelPlacing,
      undo,

      beginDragIfHit,
      updateDrag,
      endDrag,

      // render
      draw,
    };
  }

  window.Sketcher = { createSketcher };
})();
