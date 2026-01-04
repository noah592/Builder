(() => {
  function createWorld({ width, height }) {
    // =========================================================
    // RASTER MASK (sparse, chunked)
    // =========================================================
    const TILE_SIZE = 128;
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
    // INITIAL GROUND (fill below midline)
    // =========================================================
    const groundY = Math.floor(height / 2);

    function initGround() {
      for (let y = groundY; y < height; y++) {
        for (let x = 0; x < width; x++) {
          setCell(x, y, 1);
        }
      }
    }

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

    function draw(ctx, cam) {
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

    initGround();

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
