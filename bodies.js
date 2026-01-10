(() => {
  function createBodies() {
    const TILE_SIZE = 128;

    // Draw order = array order; last is topmost
    const bodies = [];
    let nextId = 1;

    // ---------------------------------------------------------
    // Tile helpers
    // ---------------------------------------------------------
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
        nonZeroCount: 0,
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
          data[p] = data[p + 1] = data[p + 2] = data[p + 3] = 255;
        } else {
          data[p] = data[p + 1] = data[p + 2] = data[p + 3] = 0;
        }
      }

      t.ctx.putImageData(t.img, 0, 0);
      t.dirty = false;
    }

    // ---------------------------------------------------------
    // AABB helpers
    // ---------------------------------------------------------
    function computeAABBFromBody(b) {
      // Use inclusive world bounds; keep consistent with how you treat x/y/w/h elsewhere.
      // This AABB is "outer rectangle" of the body's bounding box in world coordinates.
      return {
        minX: b.x,
        minY: b.y,
        maxX: b.x + b.w,
        maxY: b.y + b.h,
      };
    }

    function refreshBodyDerived(b) {
      // invMass derived from mass (mass=0 => static-style infinite mass)
      b.invMass = b.mass > 0 ? 1 / b.mass : 0;
      b.aabb = computeAABBFromBody(b);
    }

    // ---------------------------------------------------------
    // Body helpers
    // ---------------------------------------------------------
    function createEmptyBody(bounds, forcedId = null) {
      const b = {
        id: forcedId ?? nextId++,
        x: bounds.minX,
        y: bounds.minY,
        w: bounds.maxX - bounds.minX + 1,
        h: bounds.maxY - bounds.minY + 1,
        tiles: new Map(),

        // Mass = number of solid cells
        mass: 0,

        // --- Physics state (added) ---
        vx: 0,
        vy: 0,
        invMass: 0,

        // Broad-phase bounds (added)
        aabb: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      };

      // mass currently 0; invMass/aabb will be finalized after painting cells
      b.aabb = computeAABBFromBody(b);
      return b;
    }

    function getBodyById(id) {
      return bodies.find((b) => b.id === id) || null;
    }

    function removeBodyById(id) {
      const idx = bodies.findIndex((b) => b.id === id);
      if (idx !== -1) bodies.splice(idx, 1);
    }

    // ---------------------------------------------------------
    // Local cell access
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
      const lx = Math.floor(wx - body.x);
      const ly = Math.floor(wy - body.y);
      return bodyGetLocal(body, lx, ly) === 1;
    }

    function forEachSolidCellWorld(body, fn) {
      for (const t of body.tiles.values()) {
        const baseLX = t.tx * TILE_SIZE;
        const baseLY = t.ty * TILE_SIZE;

        const occ = t.occ;
        for (let i = 0; i < occ.length; i++) {
          if (!occ[i]) continue;
          const inX = i % TILE_SIZE;
          const inY = (i / TILE_SIZE) | 0;

          fn(body.x + baseLX + inX, body.y + baseLY + inY);
        }
      }
    }

    // ---------------------------------------------------------
    // Bounds helpers
    // ---------------------------------------------------------
    function bodyBounds(b) {
      return {
        minX: b.x,
        minY: b.y,
        maxX: b.x + b.w - 1,
        maxY: b.y + b.h - 1,
      };
    }

    function stampBounds(s) {
      return {
        minX: s.worldX,
        minY: s.worldY,
        maxX: s.worldX + s.w - 1,
        maxY: s.worldY + s.h - 1,
      };
    }

    function boundsIntersect(a, b) {
      return !(
        a.maxX < b.minX ||
        b.maxX < a.minX ||
        a.maxY < b.minY ||
        b.maxY < a.minY
      );
    }

    // ---------------------------------------------------------
    // Merge / split core
    // ---------------------------------------------------------
    function buildComponents(cells) {
      const set = new Set(cells.map((c) => `${c.x},${c.y}`));
      const visited = new Set();
      const comps = [];

      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];

      for (const key of set) {
        if (visited.has(key)) continue;

        const [sx, sy] = key.split(",").map(Number);
        const stack = [{ x: sx, y: sy }];
        const comp = [];

        visited.add(key);

        while (stack.length) {
          const { x, y } = stack.pop();
          comp.push({ x, y });

          for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            const nk = `${nx},${ny}`;
            if (set.has(nk) && !visited.has(nk)) {
              visited.add(nk);
              stack.push({ x: nx, y: ny });
            }
          }
        }

        comps.push(comp);
      }

      return comps;
    }

    function buildBodyFromComponent(comp, forcedId = null, inheritedState = null) {
      let minX = Infinity,
        minY = Infinity;
      let maxX = -Infinity,
        maxY = -Infinity;

      for (const { x, y } of comp) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }

      const body = createEmptyBody({ minX, minY, maxX, maxY }, forcedId);

      // Inherit basic physics state (velocity), if provided
      if (inheritedState) {
        body.vx = inheritedState.vx ?? 0;
        body.vy = inheritedState.vy ?? 0;
      }

      for (const { x, y } of comp) {
        bodySetLocal(body, x - body.x, y - body.y, 1);
      }

      refreshBodyDerived(body);
      return body;
    }

    // ---------------------------------------------------------
    // Public: create body from stamp (merge + split)
    // stamp: { worldX, worldY, w, h, data: Uint8Array(w*h) 0/1 }
    // Returns: resulting body id (new or survivor id)
    // ---------------------------------------------------------
    function createBodyFromStamp(stamp) {
      if (!stamp.data.some((v) => v)) return -1;

      // Identify touched bodies (AABB candidates, then exact overlap test)
      const touched = findTouchedBodiesByStamp(stamp);

      // Collect all cells from touched bodies + stamp
      const cells = [];

      for (const b of touched) {
        forEachSolidCellWorld(b, (x, y) => cells.push({ x, y }));
      }

      for (let sy = 0; sy < stamp.h; sy++) {
        for (let sx = 0; sx < stamp.w; sx++) {
          if (!stamp.data[sy * stamp.w + sx]) continue;
          cells.push({ x: stamp.worldX + sx, y: stamp.worldY + sy });
        }
      }

      if (cells.length === 0) return -1;

      const comps = buildComponents(cells);
      comps.sort((a, b) => b.length - a.length);

      let survivorId = null;
      let survivorVel = { vx: 0, vy: 0 };

      if (touched.length) {
        touched.sort((a, b) => b.mass - a.mass || a.id - b.id);
        survivorId = touched[0].id;
        survivorVel = { vx: touched[0].vx || 0, vy: touched[0].vy || 0 };
      }

      // Atomic replace
      for (const b of touched) removeBodyById(b.id);

      const newBodies = [];

      // Largest component keeps survivor id (if any); inherit survivor velocity
      newBodies.push(buildBodyFromComponent(comps[0], survivorId, survivorVel));

      // Other components get new ids; inherit survivor velocity as default split behavior
      for (let i = 1; i < comps.length; i++) {
        newBodies.push(buildBodyFromComponent(comps[i], null, survivorVel));
      }

      for (const b of newBodies) bodies.push(b);

      // Keep the survivor/top component on top visually
      const topId = newBodies[0].id;
      const idx = bodies.findIndex((bb) => bb.id === topId);
      if (idx !== -1 && idx !== bodies.length - 1) {
        const ref = bodies[idx];
        bodies.splice(idx, 1);
        bodies.push(ref);
      }

      return newBodies[0].id;
    }

    // ---------------------------------------------------------
    // Merge detection on create (overlap-based) - from your original
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
    // Hit test for selection (world point)
    // ---------------------------------------------------------
    function hitTest(worldPt) {
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i];

        // Quick AABB
        if (
          worldPt.x < b.x ||
          worldPt.y < b.y ||
          worldPt.x >= b.x + b.w ||
          worldPt.y >= b.y + b.h
        )
          continue;

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

      // Update broad-phase bounds when moved
      b.aabb = computeAABBFromBody(b);
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
      getBodies: () => bodies,
      draw,
    };
  }

  window.Bodies = { createBodies };
})();
