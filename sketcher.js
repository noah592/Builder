(() => {
  function createSketcher() {
    // =========================================================
    // RASTER MASK (sparse, chunked)
    // =========================================================
    const TILE_SIZE = 128; // world units per tile
    const tiles = new Map();

    function tileKey(tx, ty) {
      return `${tx},${ty}`;
    }

    function getTile(tx, ty, create = false) {
      const key = tileKey(tx, ty);
      let t = tiles.get(key);

      if (!t && create) {
        const occ = new Uint8Array(TILE_SIZE * TILE_SIZE);

        const canvas = document.createElement("canvas");
        canvas.width = TILE_SIZE;
        canvas.height = TILE_SIZE;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;

        const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);

        t = {
          tx,
          ty,
          occ,
          canvas,
          ctx,
          img,
          dirty: true,
          nonZeroCount: 0,
        };

        tiles.set(key, t);
      }

      return t || null;
    }

    function setCell(x, y, value) {
      const tx = Math.floor(x / TILE_SIZE);
      const ty = Math.floor(y / TILE_SIZE);

      const lx = x - tx * TILE_SIZE;
      const ly = y - ty * TILE_SIZE;

      const t = getTile(tx, ty, true);
      const idx = ly * TILE_SIZE + lx;

      const prev = t.occ[idx];
      if (prev === value) return;

      t.occ[idx] = value;
      t.dirty = true;

      if (prev === 0 && value === 1) t.nonZeroCount++;
      if (prev === 1 && value === 0) t.nonZeroCount--;

      if (t.nonZeroCount === 0) {
        tiles.delete(tileKey(tx, ty));
      }
    }

    function getCell(x, y) {
      const tx = Math.floor(x / TILE_SIZE);
      const ty = Math.floor(y / TILE_SIZE);

      const lx = x - tx * TILE_SIZE;
      const ly = y - ty * TILE_SIZE;

      const t = getTile(tx, ty, false);
      if (!t) return 0;

      return t.occ[ly * TILE_SIZE + lx];
    }

    // =========================================================
    // TOOL STATE (circle raster brush)
    // =========================================================
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
      if (r <= 1) {
        placing = false;
        placeR = 0;
        return false;
      }

      const cx = placeCenter.x;
      const cy = placeCenter.y;
      const r2 = r * r;
      const rInt = Math.ceil(r);

      const minX = Math.floor(cx - rInt);
      const maxX = Math.floor(cx + rInt);
      const minY = Math.floor(cy - rInt);
      const maxY = Math.floor(cy + rInt);

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = (x + 0.5) - cx;
          const dy = (y + 0.5) - cy;
          if (dx * dx + dy * dy <= r2) {
            setCell(x, y, 1);
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

    function undo() {
      // intentionally no-op for now
    }

    function beginDragIfHit() {
      return false;
    }

    function updateDrag() {}

    function endDrag() {}

    // =========================================================
    // RENDERING
    // =========================================================
    function updateTileImageIfDirty(t) {
      if (!t || !t.dirty) return;

      const data = t.img.data;
      const occ = t.occ;

      for (let i = 0; i < occ.length; i++) {
        const p = i * 4;
        if (occ[i]) {
          data[p + 0] = 255;
          data[p + 1] = 255;
          data[p + 2] = 255;
          data[p + 3] = 255;
        } else {
          data[p + 0] = 0;
          data[p + 1] = 0;
          data[p + 2] = 0;
          data[p + 3] = 0;
        }
      }

      t.ctx.putImageData(t.img, 0, 0);
      t.dirty = false;
    }

    function drawMask(ctx, cam) {
      const rect = ctx.canvas.getBoundingClientRect();
      const viewW = rect.width / cam.z;
      const viewH = rect.height / cam.z;

      const minWX = cam.x;
      const minWY = cam.y;
      const maxWX = cam.x + viewW;
      const maxWY = cam.y + viewH;

      const minTX = Math.floor(minWX / TILE_SIZE);
      const maxTX = Math.floor(maxWX / TILE_SIZE);
      const minTY = Math.floor(minWY / TILE_SIZE);
      const maxTY = Math.floor(maxWY / TILE_SIZE);

      for (let ty = minTY; ty <= maxTY; ty++) {
        for (let tx = minTX; tx <= maxTX; tx++) {
          const t = getTile(tx, ty, false);
          if (!t) continue;

          updateTileImageIfDirty(t);

          const worldX = tx * TILE_SIZE;
          const worldY = ty * TILE_SIZE;

          const sx = (worldX - cam.x) * cam.z;
          const sy = (worldY - cam.y) * cam.z;
          const sw = TILE_SIZE * cam.z;
          const sh = TILE_SIZE * cam.z;

          const sxI = Math.floor(sx);
          const syI = Math.floor(sy);
          const swI = Math.round(sw);
          const shI = Math.round(sh);

          // 1-pixel overlap eliminates seams
          ctx.drawImage(
            t.canvas,
            sxI,
            syI,
            swI + 1,
            shI + 1
          );
        }
      }
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
      ctx.arc(s.x, s.y, Math.max(0, sr), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function draw(ctx, cam, worldToScreen) {
      drawMask(ctx, cam);
      drawPreview(ctx, cam, worldToScreen);
    }

    return {
      isPlacing,
      isDragging,

      hitTestCircleAtWorldPoint,
      startPlacing,
      updatePlacing,
      finalizePlacing,
      cancelPlacing,
      undo,

      beginDragIfHit,
      updateDrag,
      endDrag,

      draw,
      getCell,
    };
  }

  window.Sketcher = { createSketcher };
})();
