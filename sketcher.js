(() => {
  function createSketcher(world) {
    let placing = false;
    let placeCenter = { x: 0, y: 0 };
    let placeR = 0;

    function isPlacing() {
      return placing;
    }

    function isDragging() {
      return false;
    }

    function hitTestCircleAtWorldPoint() {
      return -1;
    }

    function startPlacing(worldPt) {
      placing = true;
      placeCenter = { ...worldPt };
      placeR = 0;
    }

    function updatePlacing(worldPt) {
      if (!placing) return;
      placeR = Math.hypot(worldPt.x - placeCenter.x, worldPt.y - placeCenter.y);
    }

    function finalizePlacing(worldPt) {
      if (!placing) return false;

      const r = Math.hypot(worldPt.x - placeCenter.x, worldPt.y - placeCenter.y);
      if (r <= 1) {
        placing = false;
        placeR = 0;
        return false;
      }

      const cx = placeCenter.x;
      const cy = placeCenter.y;
      const r2 = r * r;
      const rInt = Math.ceil(r);

      for (let y = Math.floor(cy - rInt); y <= Math.floor(cy + rInt); y++) {
        for (let x = Math.floor(cx - rInt); x <= Math.floor(cx + rInt); x++) {
          const dx = (x + 0.5) - cx;
          const dy = (y + 0.5) - cy;
          if (dx * dx + dy * dy <= r2) {
            world.setCell(x, y, 1);
          }
        }
      }

      placing = false;
      placeR = 0;
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

      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, sr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    return {
      isPlacing,
      isDragging,
      hitTestCircleAtWorldPoint,
      startPlacing,
      updatePlacing,
      finalizePlacing,
      cancelPlacing,
      drawPreview,
    };
  }

  window.Sketcher = { createSketcher };
})();
