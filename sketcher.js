(() => {
  function createSketcher() {
    // =========================================================
    // RASTER MASK (sparse, chunked)
    // World resolution is 1 unit per cell, but we allocate only
    // where the user paints.
    // =========================================================
    const TILE_SIZE = 128; // cells per tile side (world units per tile)
    // tile key -> tile object
    const tiles = new Map();

    function tileKey(tx, ty) {
      return `${tx},${ty}`;
    }

    function getTile(tx, ty, create = false) {
      const key = tileKey(tx, ty);
      let t = tiles.get(key);
      if (!t && create) {
        // occupancy: 0 empty, 1 solid
        const occ = new Uint8Array(TILE_SIZE * TILE_SIZE);

        // offscreen canvas for this tile
        const canvas = document.createElement("canvas");
        canvas.width = TILE_SIZE;
        canvas.height = TILE_SIZE;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        // image buffer (RGBA)
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
      // x,y are world-integer coordinates
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

      // Optional cleanup: if tile becomes empty, delete it to stay sparse
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

      const idx = ly * TILE_SIZE + lx;
      return t.occ[idx];
    }

    // =========================================================
    // TOOL STATE: Circle brush via two-click placement
    // =========================================================
    let placing = false;
    let placeCenter = { x: 0, y: 0 };
    let placeR = 0;

    function isPlacing() {
      return placing;
    }

    // In raster mode, "dragging circles" isn't a thing yet.
    function isDragging() {
      return false;
    }

    function hitTestCircleAtWorldPoint(_worldPt, _camZ) {
      // No per-circle objects anymore.
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

      // Rasterize filled circle into the mask (1 unit per cell).
      // We "forget" it was a circle: we just paint pixels.
      const cx = placeCenter.x;
      const cy = placeCenter.y;

      const rInt = Math.ceil(r);
      const minX = Math.floor(cx - rInt);
      const maxX = Math.floor(cx + rInt);
      const minY = Math.floor(cy - rInt);
      const maxY = Math.floor(cy + rInt);

      const r2 = r * r;

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          // cell center test for nicer rasterization
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
      // With a mask, "undo" requires a history system.
      // For now, keep it as a no-op to avoid pretending it works.
      // (We can add proper history soon: per-stroke diff or tile snapshots.)
    }

    function beginDragIfHit(_worldPt, _camZ) {
      return false;
    }

    function updateDrag(_worldPt, _worldW, _worldH) {
      // no-op
    }

    function endDrag() {
      // no-op
    }

    // =========================================================
    // RENDERING THE MASK
    // =========================================================
    function updateTileImageIfDirty(t) {
      if (!t || !t.dirty) return;

      const data = t.img.data; // RGBA
      const occ = t.occ;

      // White for solid, transparent/black for empty.
      // Since main clears black, we can make empty pixels alpha=0.
      // But ImageData always stores RGBA; we’ll set alpha to 255 for solid, 0 for empty.
      for (let i = 0; i < occ.length; i++) {
        const o = occ[i];
        const p = i * 4;
        if (o) {
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
      // Determine visible world bounds
      const rect = ctx.canvas.getBoundingClientRect();
      const viewW = rect.width / cam.z;
      const viewH = rect.height / cam.z;

      const minWX = cam.x;
      const minWY = cam.y;
      const maxWX = cam.x + viewW;
      const maxWY = cam.y + viewH;

      // Visible tile range
      const minTX = Math.floor(minWX / TILE_SIZE);
      const maxTX = Math.floor(maxWX / TILE_SIZE);
      const minTY = Math.floor(minWY / TILE_SIZE);
      const maxTY = Math.floor(maxWY / TILE_SIZE);

      // Draw only tiles that exist (sparse)
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

         // SNAP TO INTEGER SCREEN PIXELS
const sxI = Math.round(sx);
const syI = Math.round(sy);
const swI = Math.round(sw);
const shI = Math.round(sh);

ctx.drawImage(t.canvas, sxI, syI, swI, shI);
        }
      }
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

    function draw(ctx, cam, worldToScreen) {
      // Mask first (this is the “solid white world”)
      drawMask(ctx, cam);

      // Tool preview on top
      drawPreview(ctx, cam, worldToScreen);
    }

    return {
      // state
      isPlacing,
      isDragging,

      // interactions (kept for compatibility with main, but mostly disabled)
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

      // mask access (handy later for physics)
      getCell,
    };
  }

  window.Sketcher = { createSketcher };
})();
