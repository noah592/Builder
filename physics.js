(() => {
  function createPhysics(opts = {}) {
    const GRAVITY = typeof opts.gravity === "number" ? opts.gravity : 2000;

    // More iterations = more stable stacking
    const SOLVER_ITERS = typeof opts.solverIters === "number" ? opts.solverIters : 6;

    // Limit how far we’ll try to separate in one solve attempt (cells)
    const MAX_SEP_TRY = typeof opts.maxSepTry === "number" ? opts.maxSepTry : 32;

    // Debug (optional)
    const DEBUG = opts.debug !== undefined ? !!opts.debug : false;

    function getFloorY(world) {
      if (world && typeof world.getFloorY === "function") return world.getFloorY();
      if (world && typeof world.groundY === "number") return world.groundY;
      if (world && typeof world.floorY === "number") return world.floorY;
      if (world && typeof world.height === "number") return world.height - world.height / 5;
      return 0;
    }

    function snapBodyToCells(b) {
      // Because occupancy sampling is integer-cell based
      b.x = Math.round(b.x);
      b.y = Math.round(b.y);
    }

    function collideWithGround(b, floorY) {
      if (!b || b.invMass === 0) return;

      const bottom = b.y + b.h;
      const pen = bottom - floorY;
      if (pen > 0) {
        b.y -= pen;
        snapBodyToCells(b);
        if (b.vy > 0) b.vy = 0;
      }
    }

    function anyOverlap(bodiesModule, A, B) {
      // Brute overlap: iterate smaller-mass body’s solid cells via hasSolidAtWorld sampling.
      // We don't have an iterator here, so we scan in the smaller body's bounding rect.
      // This is expensive but AABB-free.

      if (!bodiesModule || typeof bodiesModule.hasSolidAtWorld !== "function") {
        throw new Error(
          "[physics] bodies.hasSolidAtWorld(body, x, y) is missing. Expose it from bodies.js."
        );
      }

      // Choose smaller area to scan to reduce cost
      const areaA = (A.w | 0) * (A.h | 0);
      const areaB = (B.w | 0) * (B.h | 0);

      let S = A, T = B;
      if (areaB < areaA) {
        S = B; T = A;
      }

      // Scan S’s entire bounding rect; check only its solid cells
      const sx0 = Math.floor(S.x);
      const sy0 = Math.floor(S.y);
      const sx1 = sx0 + (S.w | 0);
      const sy1 = sy0 + (S.h | 0);

      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          if (!bodiesModule.hasSolidAtWorld(S, x, y)) continue;
          if (bodiesModule.hasSolidAtWorld(T, x, y)) return true;
        }
      }
      return false;
    }

    function trySeparateAxis(bodiesModule, A, B, dx, dy, maxTry) {
      // Move A and/or B along (dx,dy) by k cells until overlap clears, return k if success else 0.

      const invA = A.invMass || 0;
      const invB = B.invMass || 0;

      // If both static, can't separate
      if (invA === 0 && invB === 0) return 0;

      // Decide who moves: if one is static, move the other.
      // If both dynamic, split moves evenly in opposite directions.
      function applyShift(k) {
        if (invA > 0 && invB > 0) {
          // Split: move both half (rounded) so net separation is k
          const aK = Math.floor(k / 2);
          const bK = k - aK;
          A.x += -dx * aK;
          A.y += -dy * aK;
          B.x += dx * bK;
          B.y += dy * bK;
          snapBodyToCells(A);
          snapBodyToCells(B);
        } else if (invA > 0) {
          A.x += -dx * k;
          A.y += -dy * k;
          snapBodyToCells(A);
        } else if (invB > 0) {
          B.x += dx * k;
          B.y += dy * k;
          snapBodyToCells(B);
        }
      }

      // Save original positions to restore after failed tries
      const ax0 = A.x, ay0 = A.y;
      const bx0 = B.x, by0 = B.y;

      // Try k = 1..maxTry
      for (let k = 1; k <= maxTry; k++) {
        // Reset and apply trial shift
        A.x = ax0; A.y = ay0;
        B.x = bx0; B.y = by0;
        applyShift(k);

        if (!anyOverlap(bodiesModule, A, B)) {
          // Keep these moved positions
          return k;
        }
      }

      // Restore if no success
      A.x = ax0; A.y = ay0;
      B.x = bx0; B.y = by0;
      return 0;
    }

    function resolvePairNoAABB(bodiesModule, A, B) {
      if (!A || !B) return;
      if ((A.invMass || 0) === 0 && (B.invMass || 0) === 0) return;

      // If not overlapping, nothing to do
      if (!anyOverlap(bodiesModule, A, B)) return;

      // Try separating in 4 cardinal directions; choose the smallest k that clears overlap.
      // This avoids “reversed normal” issues because we explicitly test clearance.
      const trials = [
        { dx: 1, dy: 0 },  // separate along +x / -x
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },  // separate along +y / -y
        { dx: 0, dy: -1 },
      ];

      let best = { k: 0, dx: 0, dy: 0 };

      // Save original positions to restore between trials
      const ax0 = A.x, ay0 = A.y;
      const bx0 = B.x, by0 = B.y;

      for (const t of trials) {
        // Restore
        A.x = ax0; A.y = ay0;
        B.x = bx0; B.y = by0;

        const k = trySeparateAxis(bodiesModule, A, B, t.dx, t.dy, MAX_SEP_TRY);
        if (k > 0 && (best.k === 0 || k < best.k)) {
          best = { k, dx: t.dx, dy: t.dy };
        }
      }

      // Restore originals before applying best for real
      A.x = ax0; A.y = ay0;
      B.x = bx0; B.y = by0;

      if (best.k > 0) {
        // Apply best shift permanently
        trySeparateAxis(bodiesModule, A, B, best.dx, best.dy, best.k);

        // Kill velocity on the axis we separated (position-only stability)
        if (best.dx !== 0) {
          if (A.invMass) A.vx = 0;
          if (B.invMass) B.vx = 0;
        }
        if (best.dy !== 0) {
          if (A.invMass) A.vy = 0;
          if (B.invMass) B.vy = 0;
        }
      } else {
        // Couldn't separate within limit. As a safety, nudge up a bit for dynamic bodies.
        if (DEBUG) console.warn("[physics] Could not separate pair within MAX_SEP_TRY", A.id, B.id);
        if (A.invMass) { A.y -= 1; snapBodyToCells(A); A.vy = 0; }
        if (B.invMass) { B.y -= 1; snapBodyToCells(B); B.vy = 0; }
      }
    }

    function step(world, bodiesModule, dt) {
      if (!dt || dt <= 0) return;

      const arr = bodiesModule.getBodies ? bodiesModule.getBodies() : null;
      if (!arr) throw new Error("[physics] bodies.getBodies() missing.");

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

        snapBodyToCells(b);
      }

      // 2) Ground
      for (let i = 0; i < arr.length; i++) {
        collideWithGround(arr[i], floorY);
      }

      // 3) Solve body-body collisions (no AABB)
      for (let iter = 0; iter < SOLVER_ITERS; iter++) {
        for (let i = 0; i < arr.length; i++) {
          const A = arr[i];
          if (!A) continue;

          for (let j = i + 1; j < arr.length; j++) {
            const B = arr[j];
            if (!B) continue;

            resolvePairNoAABB(bodiesModule, A, B);
          }
        }

        // Re-apply ground after resolves (prevents sinking from pushes)
        for (let i = 0; i < arr.length; i++) {
          collideWithGround(arr[i], floorY);
        }
      }
    }

    return { step };
  }

  window.Physics = { createPhysics };
})();
