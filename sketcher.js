(() => {
  function createSketcher(bodies) {
    // =========================================================
    // TOOL STATE: Circle stamp via two-click placement
    // =========================================================
    let placing = false;
    let placeCenter = { x: 0, y: 0 };
    let placeR = 0;

    function isPlacing() {
      return placing;
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
      placing = false;
      placeR = 0;

      if (r <= 1) return false;

      // Create a generic stamp (world-aligned bitmap) for the body.
      const cx = placeCenter.x;
      const cy = placeCenter.y;

      const rInt = Math.ceil(r);
      const minX = Math.floor(cx - rInt);
      const maxX = Math.floor(cx + rInt);
      const minY = Math.floor(cy - rInt);
      const maxY = Math.floor(cy + rInt);

      const w = (maxX - minX + 1);
      const h = (maxY - minY + 1);

      const data = new Uint8Array(w * h);
      const r2 = r * r;

      for (let y = 0; y < h; y++) {
        const wy = minY + y;
        for (let x = 0; x < w; x++) {
          const wx = minX + x;
          const dx = (wx + 0.5) - cx;
          const dy = (wy + 0.5) - cy;
          if (dx * dx + dy * dy <= r2) {
            data[y * w + x] = 1;
          }
        }
      }

      bodies.createBodyFromStamp({
        worldX: minX,
        worldY: minY,
        w,
        h,
        data,
      });

      return true;
    }

    function cancelPlacing() {
      placing = false;
      placeR = 0;
    }

    function drawPreview(ctx, cam, worldToScreen) {
      if (!placing) return;

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

    return {
      isPlacing,
      startPlacing,
      updatePlacing,
      finalizePlacing,
      cancelPlacing,
      drawPreview,
    };
  }

  window.Sketcher = { createSketcher };
})();
