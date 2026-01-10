(() => {
  function createPhysics(opts = {}) {
    const GRAVITY = typeof opts.gravity === "number" ? opts.gravity : 2000;

    // More iterations = better stacking (still cheap because overlap regions are small)
    const SOLVER_ITERS = typeof opts.solverIters === "number" ? opts.solverIters : 6;

    // Ignore tiny penetrations (in cells)
    const SLOP_CELLS = typeof opts.slopCells === "number" ? opts.slopCells : 0;

    // Positional correction fraction (0..1). <1 reduces ping-pong.
    const POS_CORR = typeof opts.posCorr === "number" ? opts.posCorr : 1.0;

    function updateAABB(b) {
      if (!b.aabb) b.aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      // Keep half-open bounds: [min, max)
      b.aabb.minX = b.x;
      b.aabb.minY = b.y;
      b.aabb.maxX = b.x + b.w;
      b.aabb.maxY = b.y + b.h;
    }

    function aabbOverlap(a, b) {
      // half-open overlap test
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

    // ---------------------------------------------------------
    // Ground collision (plane at y = floorY)
    // ---------------------------------------------------------
    function collideWithGround(b, floorY) {
      if (!b || b.invMass === 0) return;

      const bottom = b.y + b.h;
      const pen = bottom - floorY;
      if (pen > 0) {
        b.y -= pen;
        if (b.vy > 0) b.vy = 0;
        updateAABB(b);
      }
    }

    // ---------------------------------------------------------
    // Narrow phase: find bounding box of overlapped SOLID cells
    // Returns null if no overlapped solid cells
    // Returns { minX, minY, maxX, maxY } inclusive integer cell coords
    // ---------------------------------------------------------
    function overlappedSolidCellBounds(bodiesModule, A, B) {
      if (!bodiesModule || typeof bodiesModule.hasSolidAtWorld !== "function") {
        console.warn("[physics] bodies.hasSolidAtWorld(body, x, y) missing.");
        return null;
      }

      const a = A.aabb;
      const b = B.aabb;

      // Intersection in world space (continuous)
      const ix0 = Math.max(a.minX, b.minX);
      const iy0 = Math.max(a.minY, b.minY);
      const ix1 = Math.min(a.maxX, b.maxX);
      const iy1 = Math.min(a.maxY, b.maxY);

      if (ix1 <= ix0 || iy1 <= iy0) return null;

      // Convert to integer cell coordinates for half-open bounds:
      // cells potentially overlapped are:
      // x in [ceil(ix0), floor(ix1-1)]
      const x0 = Math.ceil(ix0);
      const y0 = Math.ceil(iy0);
      const x1 = Math.floor(ix1 - 1e-9) - 0; // tiny epsilon to avoid ix1 exact int edge cases
      const y1 = Math.floor(iy1 - 1e-9) - 0;

      if (x1 < x0 || y1 < y0) return null;

      let minOX = Infinity, minOY = Infinity;
      let maxOX = -Infinity, maxOY = -Infinity;
      let any = false;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
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

    // ---------------------------------------------------------
    // Resolve using overlapped cell bbox to compute penetration in CELLS
    // Position-only + cancel velocity on resolved axis
    // ---------------------------------------------------------
    function resolveTileOverlap(bodiesModule, A, B) {
      if (!A || !B) return;
      if (A.invMass === 0 && B.invMass === 0) return;

      const overlapCells = overlappedSolidCellBounds(bodiesModule, A, B);
      if (!overlapCells) return;

      // Penetration depth in integer cells (inclusive bbox => +1)
      const penX = (overlapCells.maxX - overlapCells.minX + 1);
      const penY = (overlapCells.maxY - overlapCells.minY + 1);

      let nx = 0, ny = 0, sepCells = 0;

      // Choose smallest penetration axis (cell-based, stable)
      if (penX < penY) {
        sepCells = penX;
        // Direction based on centers (A pushed away from B)
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

      // Slop and correction
      sepCells = Math.max(0, sepCells - SLOP_CELLS);
      if (sepCells <= 0) return;

      const sep = sepCells * POS_CORR;

      const invA = A.invMass || 0;
      const invB = B.invMass || 0;
      const invSum = invA + invB;
      if (invSum <= 0) return;

      const moveA = sep * (invA / invSum);
      const moveB = sep * (invB / invSum);

      // Move A opposite normal, B along normal
      if (invA > 0) {
        A.x += -nx * moveA;
        A.y += -ny * moveA;

        // Cancel velocity component into the normal (position-only solver stability)
        if (nx !== 0) A.vx = 0;
        if (ny !== 0) A.vy = 0;

        updateAABB(A);
      }
      if (invB > 0) {
        B.x += nx * moveB;
        B.y += ny * moveB;

        if (nx !== 0) B.vx = 0;
        if (ny !== 0) B.vy = 0;

        updateAABB(B);
      }
    }

    // ---------------------------------------------------------
    // Step
    // ---------------------------------------------------------
    function step(world, bodiesModule, dt) {
      if (!dt || dt <= 0) return;

      const arr = bodiesModule.getBodies ? bodiesModule.getBodies() : null;
      if (!arr) {
        console.warn("[physics] bodies.getBodies() missing.");
        return;
      }

      const floorY = getFloorY(world);

      // 1) Integrate (gravity only)
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        if (!b || b.invMass === 0) continue;

        if (typeof b.vx !== "number") b.vx = 0;
        if (typeof b.vy !== "number") b.vy = 0;

        b.vy += GRAVITY * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        updateAABB(b);
      }

      // 2) Ground
      for (let i = 0; i < arr.length; i++) {
        collideWithGround(arr[i], floorY);
      }

      // 3) Body-body (AABB broad-phase + tile overlap narrow-phase)
      for (let iter = 0; iter < SOLVER_ITERS; iter++) {
        for (let i = 0; i < arr.length; i++) {
          const A = arr[i];
          if (!A) continue;

          for (let j = i + 1; j < arr.length; j++) {
            const B = arr[j];
            if (!B) continue;

            if (A.invMass === 0 && B.invMass === 0) continue;

            if (!A.aabb) updateAABB(A);
            if (!B.aabb) updateAABB(B);

            if (!aabbOverlap(A.aabb, B.aabb)) continue;

            // Resolve only if true solid overlap exists
            resolveTileOverlap(bodiesModule, A, B);
          }
        }

        // Re-apply ground after pushes
        for (let i = 0; i < arr.length; i++) {
          collideWithGround(arr[i], floorY);
        }
      }
    }

    return { step };
  }

  window.Physics = { createPhysics };
})();
