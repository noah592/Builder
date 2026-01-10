(() => {
  function createPhysics(opts = {}) {
    const GRAVITY = typeof opts.gravity === "number" ? opts.gravity : 2000;
    const SOLVER_ITERS = typeof opts.solverIters === "number" ? opts.solverIters : 6;
    const SLOP_CELLS = typeof opts.slopCells === "number" ? opts.slopCells : 0;
    const POS_CORR = typeof opts.posCorr === "number" ? opts.posCorr : 1.0;

    // If you want to hard-limit worst-case overlap scans, set e.g. 250000.
    // Leave 0 to disable.
    const MAX_SCAN_AREA = typeof opts.maxScanArea === "number" ? opts.maxScanArea : 0;

    // ---- DEBUG TRIPWIRES ----
    const DEBUG = opts.debug !== undefined ? !!opts.debug : true;
    let didOneTimeCheck = false;
    let hasSolidCalls = 0;
    let didWarnOverlapScan = false;

    function snapBodyToCells(b) {
      // Critical for stability: keep bodies on the integer grid so occupancy mapping
      // (which uses floor(wx - body.x)) doesn't "shift" as bodies move slightly.
      b.x = Math.round(b.x);
      b.y = Math.round(b.y);
    }

    function updateAABB(b) {
      if (!b.aabb) b.aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      b.aabb.minX = b.x;
      b.aabb.minY = b.y;
      b.aabb.maxX = b.x + b.w;
      b.aabb.maxY = b.y + b.h;
    }

    function aabbOverlap(a, b) {
      return !(
        a.maxX <= b.minX ||
        a.minX >= b.maxX ||
        a.maxY <= b.minY ||
        a.minY >= b.maxY
      );
    }

    function getFloorY(world) {
      if (world && typeof world.getFloorY === "function") return world.getFloorY();
      if (world && typeof world.groundY === "number") return world.groundY;
      if (world && typeof world.floorY === "number") return world.floorY;
      if (world && typeof world.height === "number") return world.height - world.height / 5;
      return 0;
    }

    function collideWithGround(b, floorY) {
      if (!b || b.invMass === 0) return;

      const bottom = b.y + b.h;
      const pen = bottom - floorY;
      if (pen > 0) {
        b.y -= pen;
        snapBodyToCells(b);
        if (b.vy > 0) b.vy = 0;
        updateAABB(b);
      }
    }

    // ---- Narrow phase overlap bounds in integer cells ----
    function overlappedSolidCellBounds(bodiesModule, A, B) {
      if (!bodiesModule || typeof bodiesModule.hasSolidAtWorld !== "function") {
        throw new Error(
          "[physics] bodies.hasSolidAtWorld(body, x, y) is missing. " +
            "You must expose it from bodies.js return object."
        );
      }

      const a = A.aabb;
      const b = B.aabb;

      const ix0 = Math.max(a.minX, b.minX);
      const iy0 = Math.max(a.minY, b.minY);
      const ix1 = Math.min(a.maxX, b.maxX);
      const iy1 = Math.min(a.maxY, b.maxY);
      if (ix1 <= ix0 || iy1 <= iy0) return null;

      // Treat AABBs as half-open [min, max)
      const x0 = Math.ceil(ix0);
      const y0 = Math.ceil(iy0);
      const x1 = Math.floor(ix1 - 1e-9);
      const y1 = Math.floor(iy1 - 1e-9);
      if (x1 < x0 || y1 < y0) return null;

      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      if (MAX_SCAN_AREA > 0 && area > MAX_SCAN_AREA) {
        if (DEBUG && !didWarnOverlapScan) {
          console.warn("[physics] Overlap scan area exceeded cap; skipping narrow-phase:", {
            x0, y0, x1, y1, area, cap: MAX_SCAN_AREA,
          });
          didWarnOverlapScan = true;
        }
        return null;
      }

      // If overlap region is huge, that's suspicious (would be slow).
      if (DEBUG && !didWarnOverlapScan && area > 200000) {
        console.warn("[physics] Huge overlap scan region:", { x0, y0, x1, y1, area });
        didWarnOverlapScan = true;
      }

      let minOX = Infinity, minOY = Infinity;
      let maxOX = -Infinity, maxOY = -Infinity;
      let any = false;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          hasSolidCalls += 2;

          if (!bodiesModule.hasSolidAtWorld(A, x, y)) continue;
          if (!bodiesModule.hasSolidAtWorld(B, x, y)) continue;

          any = true;
          if (x < minOX) minOX = x;
          if (y < minOY) minOY = y;
          if (x > maxOX) maxOX = x;
          if (y > maxOY) maxOY = y;
        }
      }

      if (!any) return null;
      return { minX: minOX, minY: minOY, maxX: maxOX, maxY: maxOY };
    }

    function resolveTileOverlap(bodiesModule, A, B) {
      if (!A || !B) return;
      if (A.invMass === 0 && B.invMass === 0) return;

      const o = overlappedSolidCellBounds(bodiesModule, A, B);
      if (!o) return;

      const penX = o.maxX - o.minX + 1;
      const penY = o.maxY - o.minY + 1;

      let nx = 0, ny = 0, sepCells = 0;

      // Choose smallest penetration axis in CELL units (stable)
      if (penX < penY) {
        sepCells = penX;
        const aCx = (A.aabb.minX + A.aabb.maxX) * 0.5;
        const bCx = (B.aabb.minX + B.aabb.maxX) * 0.5;
        nx = aCx < bCx ? -1 : 1;
        ny = 0;
      } else {
        sepCells = penY;
        const aCy = (A.aabb.minY + A.aabb.maxY) * 0.5;
        const bCy = (B.aabb.minY + B.aabb.maxY) * 0.5;
        nx = 0;
        ny = aCy < bCy ? -1 : 1;
      }

      sepCells = Math.max(0, sepCells - SLOP_CELLS);
      if (sepCells <= 0) return;

      const sep = sepCells * POS_CORR;

      const invA = A.invMass || 0;
      const invB = B.invMass || 0;
      const invSum = invA + invB;
      if (invSum <= 0) return;

      const moveA = sep * (invA / invSum);
      const moveB = sep * (invB / invSum);

      if (invA > 0) {
        A.x += -nx * moveA;
        A.y += -ny * moveA;
        snapBodyToCells(A);

        // Position-only solver: kill velocity along axis
        if (nx !== 0) A.vx = 0;
        if (ny !== 0) A.vy = 0;

        updateAABB(A);
      }

      if (invB > 0) {
        B.x += nx * moveB;
        B.y += ny * moveB;
        snapBodyToCells(B);

        if (nx !== 0) B.vx = 0;
        if (ny !== 0) B.vy = 0;

        updateAABB(B);
      }
    }

    function step(world, bodiesModule, dt) {
      if (!dt || dt <= 0) return;

      const arr = bodiesModule.getBodies ? bodiesModule.getBodies() : null;
      if (!arr) throw new Error("[physics] bodies.getBodies() missing.");

      // One-time sanity checks
      if (DEBUG && !didOneTimeCheck) {
        didOneTimeCheck = true;

        console.log("[physics] DEBUG enabled");

        if (typeof bodiesModule.hasSolidAtWorld !== "function") {
          throw new Error(
            "[physics] bodies.hasSolidAtWorld is not a function. " +
              "Your bodies.js return object did not include it correctly."
          );
        }

        if (arr.length > 0) {
          const b = arr[0];
          updateAABB(b);
          const testX = Math.floor(b.x);
          const testY = Math.floor(b.y);

          const v = bodiesModule.hasSolidAtWorld(b, testX, testY);
          console.log("[physics] hasSolidAtWorld sanity test:", {
            bodyId: b.id,
            testX,
            testY,
            returned: v,
          });
        } else {
          console.log("[physics] No bodies yet; create one and refresh.");
        }
      }

      const floorY = getFloorY(world);

      // 1) Integrate
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        if (!b || b.invMass === 0) continue;

        if (typeof b.vx !== "number") b.vx = 0;
        if (typeof b.vy !== "number") b.vy = 0;

        b.vy += GRAVITY * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        snapBodyToCells(b);
        updateAABB(b);
      }

      // 2) Ground
      for (let i = 0; i < arr.length; i++) collideWithGround(arr[i], floorY);

      // 3) Pairs
      for (let iter = 0; iter < SOLVER_ITERS; iter++) {
        for (let i = 0; i < arr.length; i++) {
          const A = arr[i];
          if (!A) continue;

          for (let j = i + 1; j < arr.length; j++) {
            const B = arr[j];
            if (!B) continue;
            if (A.invMass === 0 && B.invMass === 0) continue;

            updateAABB(A);
            updateAABB(B);

            if (!aabbOverlap(A.aabb, B.aabb)) continue;

            resolveTileOverlap(bodiesModule, A, B);
          }
        }

        for (let i = 0; i < arr.length; i++) collideWithGround(arr[i], floorY);
      }

      if (DEBUG && (performance.now() | 0) % 1000 < 16) {
        console.log("[physics] hasSolidAtWorld calls (approx/s):", hasSolidCalls);
        hasSolidCalls = 0;
      }
    }

    return { step };
  }

  window.Physics = { createPhysics };
})();
