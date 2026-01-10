(() => {
  function createWorld({ width, height }) {
    // =========================================================
    // WORLD CONSTANTS
    // =========================================================
    const TILE_SIZE = 128;

    // Ground is the midline: below is solid by default
    const groundY = Math.floor(height/5);

    // Override encoding per cell:
    // 0 = UNSET (use default)
    // 1 = FORCE_EMPTY
    // 2 = FORCE_SOLID
    const UNSET = 0;
    const FORCE_EMPTY = 1;
    const FORCE_SOLID = 2;

    // tile key -> tile object
    const tiles = new Map();

    function tileKey(tx, ty) {
      return `${tx},${ty}`;
    }

    function getTile(tx, ty, create = false) {
      const key = tileKey(tx, ty);
      let t = tiles.get(key);

      if (!t && create) {
        // Only overrides are stored here (sparse)
        const cell = new Uint8Array(TILE_SIZE * TILE_SIZE);

        const canvas = document.createElement("canvas");
        canvas.width = TILE_SIZE;
        canvas.height = TILE_SIZE;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;

        const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);

        t = {
          tx,
          ty,
          cell,     // override data
          canvas,
          ctx,
          img,
          dirty: true,
          nonZeroCount: 0, // number of non-UNSET cells
        };

        tiles.set(key, t);
      }

      return t || null;
    }

    function defaultCellValue(x, y) {
      // (x is unused for now, but kept for symmetry/future)
      return y >= groundY ? 1 : 0;
    }

    function setCell(x, y, value) {
      // Ignore out-of-world writes (prevents accidental huge allocation)
      if (x < 0 || y < 0 || x >= width || y >= height) return;

      const def = defaultCellValue(x, y);

      // Determine override needed (or unset)
      let ov = UNSET;
      if (value !== def) {
        ov = value ? FORCE_SOLID : FORCE_EMPTY;
      }

      const tx = Math.floor(x / TILE_SIZE);
      const ty = Math.floor(y / TILE_SIZE);
      const lx = x - tx * TILE_SIZE;
      const ly = y - ty * TILE_SIZE;

      // Only allocate a tile if we truly need an override
      const t = ov === UNSET ? getTile(tx, ty, false) : getTile(tx, ty, true);
      if (!t) return; // no tile exists and no override needed

      const idx = ly * TILE_SIZE + lx;
      const prev = t.cell[idx];

      if (prev === ov) return;

      // update counts
      if (prev === UNSET && ov !== UNSET) t.nonZeroCount++;
      if (prev !== UNSET && ov === UNSET) t.nonZeroCount--;

      t.cell[idx] = ov;
      t.dirty = true;

      // If tile has no overrides left, delete it to stay sparse
      if (t.nonZeroCount === 0) {
        tiles.delete(tileKey(tx, ty));
      }
    }

    function getCell(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return 0;

      const tx = Math.floor(x / TILE_SIZE);
      const ty = Math.floor(y / TILE_SIZE);
      const lx = x - tx * TILE_SIZE;
      const ly = y - ty * TILE_SIZE;

      const t = getTile(tx, ty, false);
      const def = defaultCellValue(x, y);

      if (!t) return def;

      const ov = t.cell[ly * TILE_SIZE + lx];
      if (ov === UNSET) return def;
      return ov === FORCE_SOLID ? 1 : 0;
    }

    // =========================================================
    // RENDERING
    // =========================================================
    function updateTileImageIfDirty(t) {
      if (!t || !t.dirty) return;

      const data = t.img.data;
      const cell = t.cell;

      // UNSET: transparent (no draw)
      // FORCE_SOLID: white pixel (opaque)
      // FORCE_EMPTY: black pixel (opaque) -> carves holes in the ground
      for (let i = 0; i < cell.length; i++) {
        const p = i * 4;
        const ov = cell[i];

        if (ov === FORCE_SOLID) {
          data[p + 0] = 255;
          data[p + 1] = 255;
          data[p + 2] = 255;
          data[p + 3] = 255;
        } else if (ov === FORCE_EMPTY) {
          data[p + 0] = 0;
          data[p + 1] = 0;
          data[p + 2] = 0;
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

    function drawGroundRect(ctx, cam) {
      // Draw ONLY the visible portion of the ground as one rectangle.
      // World coordinates: ground occupies y in [groundY, height)
      const rect = ctx.canvas.getBoundingClientRect();
      const viewW = rect.width / cam.z;
      const viewH = rect.height / cam.z;

      const viewMinX = cam.x;
      const viewMinY = cam.y;
      const viewMaxX = cam.x + viewW;
      const viewMaxY = cam.y + viewH;

      // Visible Y-range intersection with ground
      const gy0 = Math.max(groundY, viewMinY);
      const gy1 = Math.min(height, viewMaxY);

      if (gy1 <= gy0) return; // ground not visible

      // Clamp X to world bounds (optional, but nice)
      const gx0 = Math.max(0, viewMinX);
      const gx1 = Math.min(width, viewMaxX);
      if (gx1 <= gx0) return;

      const sx = (gx0 - cam.x) * cam.z;
      const sy = (gy0 - cam.y) * cam.z;
      const sw = (gx1 - gx0) * cam.z;
      const sh = (gy1 - gy0) * cam.z;

      // Snap to pixels for crispness
      const sxI = Math.floor(sx);
      const syI = Math.floor(sy);
      const swI = Math.ceil(sw);
      const shI = Math.ceil(sh);

      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.fillRect(sxI, syI, swI, shI);
      ctx.restore();
    }

    function drawOverrides(ctx, cam) {
      const rect = ctx.canvas.getBoundingClientRect();
      const viewW = rect.width / cam.z;
      const viewH = rect.height / cam.z;

      const minTX = Math.floor(cam.x / TILE_SIZE);
      const maxTX = Math.floor((cam.x + viewW) / TILE_SIZE);
      const minTY = Math.floor(cam.y / TILE_SIZE);
      const maxTY = Math.floor((cam.y + viewH) / TILE_SIZE);

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

          // 1-pixel overlap (seam killer)
          ctx.drawImage(t.canvas, sxI, syI, swI + 1, shI + 1);
        }
      }
    }

    function draw(ctx, cam) {
      // 1) implicit ground
      drawGroundRect(ctx, cam);

      // 2) sparse overrides (both white solids above ground and black carve-outs below)
      drawOverrides(ctx, cam);
    }

    return {
      width,
      height,
      groundY,
      setCell,
      getCell,
      draw,
    };
  }

  window.World = { createWorld };
})();
