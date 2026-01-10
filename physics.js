(() => {
  function createPhysics(opts = {}) {
    // Gravity in world-units / second^2 (positive Y = down)
    const GRAVITY = typeof opts.gravity === "number" ? opts.gravity : 2000;

    // Solver iterations (more = better stacking / less sinking)
    const SOLVER_ITERS = typeof opts.solverIters === "number" ? opts.solverIters : 4;

    // Small penetration slop (reduces jitter)
    const SLOP = typeof opts.slop === "number" ? opts.slop : 0.5;

    // Positional correction fraction (0..1). <1 reduces ping-pong.
    const POS_CORR = typeof opts.posCorr === "number" ? opts.posCorr : 0.8;

    // Cap per-pair separation per iteration to avoid “teleporty” corrections
    const MAX_SEP = typeof opts.maxSep === "number" ? opts.maxSep : 64;

    // ---------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------
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

    // ---------------------------------------------------------
    // Ground collision: clamp body bottom to floor plane
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
    // Tile-based narrow phase
    // Determine if actual solids overlap inside AABB intersection
    // ---------------------------------------------------------
    function computeIntersectionCells(A, B) {
      const a = A.aabb;
      const b = B.aabb;

      const ix0 = Math.max(a.minX, b.minX);
      const iy0 = Math.max(a.minY, b.minY);
      const ix1 = Math.min(a.maxX, b.maxX);
      const iy1 = Math.min(a.maxY, b.maxY);

      // We will iterate integer cell coordinates.
      // Use floor/ceil to cover all potentially overlapping integer cells.
      const x0 = Math.floor(ix0);
      const y0 = Math.floor(iy0);
      const x1 = Math.ceil(ix1);
      const y1 = Math.ceil(iy1);

      return { x0, y0, x1, y1 };
    }

    function hasAnySolidOverlap(bodiesModule, A, B) {
      if (!bodiesModule || typeof bodiesModule.hasSolidAtWorld !== "function") {
        console.warn("[physics] bodies.hasSolidAtWorld(body, x, y) missing.");
        return false;
      }

      const { x0, y0, x1, y1 } = computeIntersectionCells(A, B);
      if (x1 <= x0 || y1 <= y0) return false;

      // Iterate overlap region; early out on first solid-solid cell.
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (!bodiesModule.hasSolidAtWorld(A, x, y)) continue;
          if (bodiesModule.hasSolidAtWorld(B, x, y)) return true;
        }
      }
      return false;
    }

    // ---------------------------------------------------------
    // Choose a stable separation axis (normal) for tile overlap
    // We still use AABB minimum overlap axis, but ONLY after confirming
    // actual tile overlap. This removes most false-positive jitter.
    // ---------------------------------------------------------
    function computeAABBNormalAndDepth(A, B) {
      const a = A.aabb;
      const b = B.aabb;

      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);

      let nx = 0, ny = 0, sep = 0;

      if (overlapX < overlapY) {
        sep = overlapX;
        const aCx = (a.minX + a.maxX) * 0.5;
        const bCx = (b.minX + b.maxX) * 0.5;
        nx = aCx < bCx ? -1 : 1;
        ny = 0;
      } else {
        sep = overlapY;
        const aCy = (a.minY + a.maxY) * 0.5;
        const bCy = (b.minY + b.maxY) * 0.5;
        nx = 0;
        ny = aCy < bCy ? -1 : 1;
      }

      return { nx, ny, sep };
    }

    // ---------------------------------------------------------
    // Resolve a confirmed (tile-overlap) collision pair
    // Positional correction + cancel relative normal velocity (inelastic)
    // ---------------------------------------------------------
    function resolveConfirmedOverlap(A, B) {
      if (!A || !B) return;
      if (A.invMass === 0 && B.invMass === 0) return;

      const { nx, ny, sep } = computeAABBNormalAndDepth(A, B);

      // Apply slop + correction factor
      let corrected = Math.max(0, sep - SLOP) * POS_CORR;
      if (corrected <= 0) return;

      corrected = Math.min(corrected, MAX_SEP);

      const invA = A.invMass || 0;
      const invB = B.invMass || 0;
      const invSum = invA + invB;
      if (invSum <= 0) return;

      const moveA = corrected * (invA / invSum);
      const moveB = corrected * (invB / invSum);

      // Separate: move A opposite normal, B along normal
      if (invA > 0) {
        A.x += -nx * moveA;
        A.y += -ny * moveA;
        updateAABB(A);
      }
      if (invB > 0) {
        B.x += nx * moveB;
        B.y += ny * moveB;
        updateAABB(B);
      }

      // Cancel relative velocity into the normal (no bounce yet)
      const rvx = (B.vx || 0) - (A.vx || 0);
      const rvy = (B.vy || 0) - (A.vy || 0);
      const relN = rvx * nx + rvy * ny;

      if (relN >= 0) return;

      const j = -relN / invSum;

      if (invA > 0) {
        A.vx -= j * invA * nx;
        A.vy -= j * invA * ny;
      }
      if (invB > 0) {
        B.vx += j * invB * nx;
        B.vy += j * invB * ny;
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

      // 2) Ground collision
      for (let i = 0; i < arr.length; i++) {
        collideWithGround(arr[i], floorY);
      }

      // 3) Body-body collisions (AABB broad-phase + tile narrow-phase)
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

            // Broad-phase
            if (!aabbOverlap(A.aabb, B.aabb)) continue;

            // Narrow-phase: actual tile overlap?
            if (!hasAnySolidOverlap(bodiesModule, A, B)) continue;

            // Resolve confirmed overlap
            resolveConfirmedOverlap(A, B);
          }
        }

        // Re-apply ground after pair resolutions (prevents sinking)
        for (let i = 0; i < arr.length; i++) {
          collideWithGround(arr[i], floorY);
        }
      }
    }

    return { step };
  }

  window.Physics = { createPhysics };
})();
