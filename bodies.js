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
    // Body helpers
    // ---------------------------------------------------------
    function createEmptyBody(bounds, forcedId = null) {
      return {
        id: forcedId ?? nextId++,
        x: bounds.minX,
        y: bounds.minY,
        w: bounds.maxX - bounds.minX + 1,
        h: bounds.maxY - bounds.minY + 1,
        tiles: new Map(),
        mass: 0,
      };
    }

    function getBodyById(id) {
      return bodies.find(b => b.id === id) || null;
    }

    function removeBodyById(id) {
      const idx = bodies.findIndex(b => b.id === id);
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
      return !(a.maxX < b.minX || b.maxX < a.minX ||
               a.maxY < b.minY || b.maxY < a.minY);
    }

    // ---------------------------------------------------------
    // Merge / split core
    // ---------------------------------------------------------
    function buildComponents(cells) {
      const set = new Set(cells.map(c => `${c.x},${c.y}`));
      const visited = new Set();
      const comps = [];

      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

      for (const key of set) {
        if (visited.has(key)) continue;

        const [sx, sy] = key.split(',').map(Number);
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

    function buildBodyFromComponent(comp, forcedId = null) {
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;

      for (const { x, y } of comp) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }

      const body = createEmptyBody(
        { minX, minY, maxX, maxY },
        forcedId
      );

      for (const { x, y } of comp) {
        bodySetLocal(body, x - body.x, y - body.y, 1);
      }

      return body;
    }

    // ---------------------------------------------------------
    // Public: create body from stamp (merge + split)
    // ---------------------------------------------------------
    function createBodyFromStamp(stamp) {
      if (!stamp.data.some(v => v)) return -1;

      const sb = stampBounds(stamp);
      const touched = bodies.filter(b =>
        boundsIntersect(bodyBounds(b), sb)
      );

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
      if (touched.length) {
        touched.sort((a, b) => b.mass - a.mass || a.id - b.id);
        survivorId = touched[0].id;
      }

      for (const b of touched) removeBodyById(b.id);

      const newBodies = [];
      newBodies.push(buildBodyFromComponent(comps[0], survivorId));

      for (let i = 1; i < comps.length; i++) {
        newBodies.push(buildBodyFromComponent(comps[i]));
      }

      for (const b of newBodies) bodies.push(b);

      return newBodies[0].id;
    }

    // ---------------------------------------------------------
    // Selection / movement / query
    // ---------------------------------------------------------
    function hitTest(worldPt) {
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i];
        if (
          worldPt.x < b.x || worldPt.y < b.y ||
          worldPt.x >= b.x + b.w ||
          worldPt.y >= b.y + b.h
        ) continue;

        if (bodyGetLocal(b,
          Math.floor(worldPt.x - b.x),
          Math.floor(worldPt.y - b.y)
        )) return b.id;
      }
      return -1;
    }

    function setBodyPos(id, x, y) {
      const b = getBodyById(id);
      if (b) { b.x = x; b.y = y; }
    }

    function getBodyPos(id) {
      const b = getBodyById(id);
      return b ? { x: b.x, y: b.y } : null;
    }

    function getBodyMass(id) {
      const b = getBodyById(id);
      return b ? b.mass : 0;
    }

    // ---------------------------------------------------------
    // Drawing
    // ---------------------------------------------------------
    function draw(ctx, cam) {
      const rect = ctx.canvas.getBoundingClientRect();
      const viewW = rect.width / cam.z;
      const viewH = rect.height / cam.z;

      for (const b of bodies) {
        for (const t of b.tiles.values()) {
          updateTileImageIfDirty(t);

          const wx = b.x + t.tx * TILE_SIZE;
          const wy = b.y + t.ty * TILE_SIZE;

          const sx = (wx - cam.x) * cam.z;
          const sy = (wy - cam.y) * cam.z;
          const sw = TILE_SIZE * cam.z;
          const sh = TILE_SIZE * cam.z;

          ctx.drawImage(
            t.canvas,
            Math.floor(sx),
            Math.floor(sy),
            Math.round(sw) + 1,
            Math.round(sh) + 1
          );
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
