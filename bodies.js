(() => {
  function createBodies() {
    const TILE_SIZE = 128;

    // Body list (draw order = array order; last is topmost)
    const bodies = [];
    let nextId = 1;

    function tileKey(tx, ty) {
      return `${tx},${ty}`;
    }

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
        nonZeroCount: 0, // solid cell count within this tile
      };
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

    function createEmptyBodyAtBounds(bounds) {
      const id = nextId++;
      return {
        id,
        x: bounds.minX,
        y: bounds.minY,
        w: bounds.maxX - bounds.minX + 1,
        h: bounds.maxY - bounds.minY + 1,
        tiles: new Map(),
        mass: 0, // number of SOLID CELLS
      };
    }

    function getBodyById(id) {
      for (let i = 0; i < bodies.length; i++) {
        if (bodies[i].id === id) return bodies[i];
      }
      return null;
    }

    function removeBodyById(id) {
      const idx = bodies.findIndex((b) => b.id === id);
      if (idx !== -1) bodies.splice(idx, 1);
    }

    // ---------------------------------------------------------
    // Cell query/set in a body (body-local coords)
    // ---------------------------------------------------------
    function bodyGetLocal(body, lx, ly) {
      if (lx < 0 || ly < 0 || lx >= body.w || ly >= body.h) return 0;

      const tx = Math.floor(lx / TILE_SIZE);
      const ty = Math.floor(ly / TILE_SIZE);
      const inX = lx - tx * TILE_SIZE;
      const inY = ly - ty * TILE_SIZE;

      const t = getTile(body, tx, ty, false);
      if (!t) return 0;

      return t.occ[inY * TILE_SIZE + inX] ? 1 : 0;
    }

    function bodySetLocal(body, lx, ly, value) {
      if (lx < 0 || ly < 0 || lx >= body.w || ly >= body.h) return;

      const tx = Math.floor(lx / TILE_SIZE);
      const ty = Math.floor(ly / TILE_SIZE);
      const inX = lx - tx * TILE_SIZE;
      const inY = ly - ty * TILE_SIZE;

      const t = getTile(body, tx, ty, value === 1);
      if (!t) return;

      const idx = inY * TILE_SIZE + inX;
      const prev = t.occ[idx];

      if (value) {
        if (!prev) {
          t.occ[idx] = 1;
          t.dirty = true;
          t.nonZeroCount++;
          body.mass++;
        }
      } else {
        if (prev) {
          t.occ[idx] = 0;
          t.dirty = true;
          t.nonZeroCount--;
          body.mass--;
          if (t.nonZeroCount === 0) {
            body.tiles.delete(tileKey(tx, ty));
          }
        }
      }
    }

    function bodyHasSolidAtWorld(body, wx, wy) {
      // World -> local
      const lx = Math.floor(wx - body.x);
      const ly = Math.floor(wy - body.y);
      return bodyGetLocal(body, lx, ly) === 1;
    }

    // ---------------------------------------------------------
    // Bounds helpers
    // ---------------------------------------------------------
    function stampBounds(stamp) {
      return {
        minX: stamp.worldX,
        minY: stamp.worldY,
        maxX: stamp.worldX + stamp.w - 1,
        maxY: stamp.worldY + stamp.h - 1,
      };
    }

    function bodyBounds(body) {
      return {
        minX: body.x,
        minY: body.y,
        maxX: body.x + body.w - 1,
        maxY: body.y + body.h - 1,
      };
    }

    function unionBounds(a, b) {
      return {
        minX: Math.min(a.minX, b.minX),
        minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX),
        maxY: Math.max(a.maxY, b.maxY),
      };
    }

    function boundsIntersect(a, b) {
      return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
    }

    // ---------------------------------------------------------
    // Iterate solid cells of a body in WORLD coords
    // ---------------------------------------------------------
    function forEachSolidCellWorld(body, fn) {
      // Iterate tiles, then cells within tile
      for (const t of body.tiles.values()) {
        const baseLX = t.tx * TILE_SIZE;
        const baseLY = t.ty * TILE_SIZE;

        const occ = t.occ;
        for (let i = 0; i < occ.length; i++) {
          if (!occ[i]) continue;
          const inX = i % TILE_SIZE;
          const inY = (i / TILE_SIZE) | 0;

          const lx = baseLX + inX;
          const ly = baseLY + inY;

          // Local -> world
          const wx = body.x + lx;
          const wy = body.y + ly;

          fn(wx, wy);
        }
      }
    }

    // ---------------------------------------------------------
    // Build/replace survivor with union of (survivor + other bodies + stamp)
    // ---------------------------------------------------------
    function rebuildSurvivorAsUnion(survivor, bodiesToAbsorb, stamp) {
      // Compute union bounds
      let ub = bodyBounds(survivor);
      for (const b of bodiesToAbsorb) ub = unionBounds(ub, bodyBounds(b));
      ub = unionBounds(ub, stampBounds(stamp));

      const newBody = createEmptyBodyAtBounds(ub);

      // Keep survivor id (identity continuity)
      newBody.id = survivor.id;

      // Paint survivor cells
      forEachSolidCellWorld(survivor, (wx, wy) => {
        const lx = wx - newBody.x;
        const ly = wy - newBody.y;
        bodySetLocal(newBody, lx, ly, 1);
      });

      // Paint absorbed bodies
      for (const b of bodiesToAbsorb) {
        forEachSolidCellWorld(b, (wx, wy) => {
          const lx = wx - newBody.x;
          const ly = wy - newBody.y;
          bodySetLocal(newBody, lx, ly, 1);
        });
      }

      // Paint stamp solids
      const sData = stamp.data;
      for (let sy = 0; sy < stamp.h; sy++) {
        const wy = stamp.worldY + sy;
        for (let sx = 0; sx < stamp.w; sx++) {
          if (!sData[sy * stamp.w + sx]) continue;
          const wx = stamp.worldX + sx;

          const lx = wx - newBody.x;
          const ly = wy - newBody.y;
          bodySetLocal(newBody, lx, ly, 1);
        }
      }

      // Replace survivor fields (keep same object reference)
      survivor.x = newBody.x;
      survivor.y = newBody.y;
      survivor.w = newBody.w;
      survivor.h = newBody.h;
      survivor.tiles = newBody.tiles;
      survivor.mass = newBody.mass;
    }

    // ---------------------------------------------------------
    // Merge detection on create (overlap-based)
    // ---------------------------------------------------------
    function findTouchedBodiesByStamp(stamp) {
      const touched = [];

      const sb = stampBounds(stamp);

      // Candidate bodies by AABB intersection
      const candidates = bodies.filter((b) => boundsIntersect(bodyBounds(b), sb));
      if (candidates.length === 0) return touched;

      const sData = stamp.data;

      // For each candidate, test actual overlap by scanning stamp solids
      // and querying candidate occupancy at those world coords.
      // Early-exit once a body is confirmed touched.
      for (const b of candidates) {
        let hit = false;

        // Iterate stamp cells; if many, this is still fine for now (incremental step)
        for (let sy = 0; sy < stamp.h && !hit; sy++) {
          const wy = stamp.worldY + sy;
          for (let sx = 0; sx < stamp.w; sx++) {
            if (!sData[sy * stamp.w + sx]) continue;

            const wx = stamp.worldX + sx;
            if (bodyHasSolidAtWorld(b, wx, wy)) {
              hit = true;
              break;
            }
          }
        }

        if (hit) touched.push(b);
      }

      return touched;
    }

    // ---------------------------------------------------------
    // Public: create body from a generic stamp
    // stamp: { worldX, worldY, w, h, data: Uint8Array(w*h) 0/1 }
    // Returns: resulting body id (new or survivor id)
    // ---------------------------------------------------------
    function createBodyFromStamp(stamp) {
      // Fast path: if no solids, ignore
      let any = false;
      for (let i = 0; i < stamp.data.length; i++) {
        if (stamp.data[i]) {
          any = true;
          break;
        }
      }
      if (!any) return -1;

      const touched = findTouchedBodiesByStamp(stamp);

      if (touched.length === 0) {
        // Create new body exactly from stamp bounds
        const b = {
          id: nextId++,
          x: stamp.worldX,
          y: stamp.worldY,
          w: stamp.w,
          h: stamp.h,
          tiles: new Map(),
          mass: 0,
        };

        // Paint stamp into body-local coords
        const sData = stamp.data;
        for (let ly = 0; ly < stamp.h; ly++) {
          for (let lx = 0; lx < stamp.w; lx++) {
            if (!sData[ly * stamp.w + lx]) continue;
            bodySetLocal(b, lx, ly, 1);
          }
        }

        bodies.push(b);
        return b.id;
      }

      // Choose survivor = largest mass (ties -> lowest id)
      touched.sort((a, b) => (b.mass - a.mass) || (a.id - b.id));
      const survivor = touched[0];
      const toAbsorb = touched.slice(1);

      // Rebuild survivor as union(survivor + absorb + stamp)
      rebuildSurvivorAsUnion(survivor, toAbsorb, stamp);

      // Remove absorbed bodies from list
      for (const b of toAbsorb) {
        removeBodyById(b.id);
      }

      // Keep survivor on top visually if the new stamp was just created:
      // move survivor to end of draw order so it feels like “the thing you just made/edited”
      const sIdx = bodies.findIndex((bb) => bb.id === survivor.id);
      if (sIdx !== -1 && sIdx !== bodies.length - 1) {
        bodies.splice(sIdx, 1);
        bodies.push(survivor);
      }

      return survivor.id;
    }

    // ---------------------------------------------------------
    // Hit test for selection (world point)
    // ---------------------------------------------------------
    function hitTest(worldPt) {
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i];

        // Quick AABB
        if (
          worldPt.x < b.x || worldPt.y < b.y ||
          worldPt.x >= b.x + b.w || worldPt.y >= b.y + b.h
        ) continue;

        // Exact occupancy test
        const lx = Math.floor(worldPt.x - b.x);
        const ly = Math.floor(worldPt.y - b.y);
        if (bodyGetLocal(b, lx, ly)) return b.id;
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

    function getBodyMass(id) {
      const b = getBodyById(id);
      if (!b) return 0;
      return b.mass;
    }

    // ---------------------------------------------------------
    // Draw bodies
    // ---------------------------------------------------------
    function draw(ctx, cam) {
      // Draw each body by drawing its tiles at body transform (translation only)
      const rect = ctx.canvas.getBoundingClientRect();
      const viewW = rect.width / cam.z;
      const viewH = rect.height / cam.z;

      const viewMinWX = cam.x;
      const viewMinWY = cam.y;
      const viewMaxWX = cam.x + viewW;
      const viewMaxWY = cam.y + viewH;

      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];

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
      getBodyMass,
      draw,
    };
  }

  window.Bodies = { createBodies };
})();
