(() => {
  function createBodies() {
    const TILE_SIZE = 128;
    const bodies = [];
    let nextId = 1;

    function makeTile(tx, ty) {
      const occ = new Uint8Array(TILE_SIZE * TILE_SIZE);

      const canvas = document.createElement("canvas");
      canvas.width = TILE_SIZE;
      canvas.height = TILE_SIZE;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;

      const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);

      return {
        tx,
        ty,
        occ,
        canvas,
        ctx,
        img,
        dirty: true,
        nonZeroCount: 0,
      };
    }

    function tileKey(tx, ty) {
      return `${tx},${ty}`;
    }

    function getTile(body, tx, ty, create = false) {
      const key = tileKey(tx, ty);
      let t = body.tiles.get(key);
      if (!t && create) {
        t = makeTile(tx, ty);
        body.tiles.set(key, t);
      }
      return t || null;
    }

    function updateTileImageIfDirty(t) {
      if (!t || !t.dirty) return;

      const data = t.img.data;
      const occ = t.occ;

      // White opaque for solid, transparent for empty
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

    function createBodyFromStamp(stamp) {
      // stamp: {
      //   worldX, worldY, w, h,
      //   data: Uint8Array(w*h) with 0/1
      // }
      const id = nextId++;

      const body = {
        id,
        // For now, body position is top-left of the stamp in world space.
        // Later we can move to centroid-based transforms without changing storage.
        x: stamp.worldX,
        y: stamp.worldY,

        w: stamp.w,
        h: stamp.h,

        // sparse tile map: key -> tile
        tiles: new Map(),
      };

      // Populate tiles from stamp data (local coords [0..w-1], [0..h-1])
      const data = stamp.data;
      for (let ly = 0; ly < stamp.h; ly++) {
        for (let lx = 0; lx < stamp.w; lx++) {
          const v = data[ly * stamp.w + lx];
          if (!v) continue;

          const tx = Math.floor(lx / TILE_SIZE);
          const ty = Math.floor(ly / TILE_SIZE);
          const inX = lx - tx * TILE_SIZE;
          const inY = ly - ty * TILE_SIZE;

          const t = getTile(body, tx, ty, true);
          const idx = inY * TILE_SIZE + inX;

          if (t.occ[idx] === 0) {
            t.occ[idx] = 1;
            t.dirty = true;
            t.nonZeroCount++;
          }
        }
      }

      bodies.push(body);
      return id;
    }

    function getBodyById(id) {
      for (let i = 0; i < bodies.length; i++) {
        if (bodies[i].id === id) return bodies[i];
      }
      return null;
    }

    function hitTest(worldPt) {
      // Topmost body wins (last created drawn last)
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i];

        // Quick AABB
        if (
          worldPt.x < b.x || worldPt.y < b.y ||
          worldPt.x >= b.x + b.w || worldPt.y >= b.y + b.h
        ) continue;

        // Precise cell test in body-local coords
        const lx = Math.floor(worldPt.x - b.x);
        const ly = Math.floor(worldPt.y - b.y);
        if (lx < 0 || ly < 0 || lx >= b.w || ly >= b.h) continue;

        const tx = Math.floor(lx / TILE_SIZE);
        const ty = Math.floor(ly / TILE_SIZE);
        const inX = lx - tx * TILE_SIZE;
        const inY = ly - ty * TILE_SIZE;

        const t = getTile(b, tx, ty, false);
        if (!t) continue;

        const idx = inY * TILE_SIZE + inX;
        if (t.occ[idx]) return b.id;
      }
      return -1;
    }

    function setBodyPos(id, x, y) {
      const b = getBodyById(id);
      if (!b) return;
      b.x = x;
      b.y = y;
    }

    function getBodyPos(id) {
      const b = getBodyById(id);
      if (!b) return null;
      return { x: b.x, y: b.y };
    }

    function draw(ctx, cam) {
      // Draw each body by drawing its tiles at body transform (translation only)
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];

        // Body-local tile bounds that might be visible.
        // We compute visible range in world, convert to body-local, then to tiles.
        const rect = ctx.canvas.getBoundingClientRect();
        const viewW = rect.width / cam.z;
        const viewH = rect.height / cam.z;

        const viewMinWX = cam.x;
        const viewMinWY = cam.y;
        const viewMaxWX = cam.x + viewW;
        const viewMaxWY = cam.y + viewH;

        // Intersect view with body AABB (world)
        const bx0 = b.x;
        const by0 = b.y;
        const bx1 = b.x + b.w;
        const by1 = b.y + b.h;

        const ix0 = Math.max(viewMinWX, bx0);
        const iy0 = Math.max(viewMinWY, by0);
        const ix1 = Math.min(viewMaxWX, bx1);
        const iy1 = Math.min(viewMaxWY, by1);

        if (ix1 <= ix0 || iy1 <= iy0) continue;

        // Convert intersection to body-local coords
        const l0x = Math.floor(ix0 - b.x);
        const l0y = Math.floor(iy0 - b.y);
        const l1x = Math.ceil(ix1 - b.x);
        const l1y = Math.ceil(iy1 - b.y);

        const minTX = Math.floor(l0x / TILE_SIZE);
        const minTY = Math.floor(l0y / TILE_SIZE);
        const maxTX = Math.floor((l1x - 1) / TILE_SIZE);
        const maxTY = Math.floor((l1y - 1) / TILE_SIZE);

        for (let ty = minTY; ty <= maxTY; ty++) {
          for (let tx = minTX; tx <= maxTX; tx++) {
            const t = getTile(b, tx, ty, false);
            if (!t) continue;

            updateTileImageIfDirty(t);

            const worldX = b.x + tx * TILE_SIZE;
            const worldY = b.y + ty * TILE_SIZE;

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
    }

    return {
      createBodyFromStamp,
      hitTest,
      setBodyPos,
      getBodyPos,
      draw,
    };
  }

  window.Bodies = { createBodies };
})();
