(() => {
  function createPhysics(opts = {}) {
    const GRAVITY = typeof opts.gravity === "number" ? opts.gravity : 2000;

    // More iterations = more stable stacking
    const SOLVER_ITERS = typeof opts.solverIters === "number" ? opts.solverIters : 6;

    // Limit how far we’ll try to separate in one solve attempt (cells)
    const MAX_SEP_TRY = typeof opts.maxSepTry === "number" ? opts.maxSepTry : 32;

    // Restitution (bounciness). Start at 0 for stability.
    const RESTITUTION = typeof opts.restitution === "number" ? opts.restitution : 0.4;

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

        // Cancel closing velocity into ground normal (0, -1)
        if (b.vy > 0) b.vy = 0;
      }
    }

    function anyOverlap(bodiesModule, A, B) {
      // Brute overlap: iterate smaller bounding rect; check only its solid cells
      if (!bodiesModule || typeof bodiesModule.hasSolidAtWorld !== "function") {
        throw new Error(
          "[physics] bodies.hasSolidAtWorld(body, x, y) is missing. Expose it from bodies.js."
        );
      }

      const areaA = (A.w | 0) * (A.h | 0);
      const areaB = (B.w | 0) * (B.h | 0);

      let S = A, T = B;
      if (areaB < areaA) {
        S = B; T = A;
      }

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

    function applyNormalImpulse(A, B, nx, ny) {
      // Only normal impulse, no friction, no rotation.
    

      const invA = A.invMass || 0;
      const invB = B.invMass || 0;
      const invSum = invA + invB;
      if (invSum <= 0) return;

      // Relative velocity along normal
      const rvx = B.vx - A.vx;
      const rvy = B.vy - A.vy;
      const vn = rvx * nx + rvy * ny;

      // Only if closing (vn < 0)
      if (vn >= 0) return;

      const e = RESTITUTION;
      const j = -(1 + e) * vn / invSum;

      // Apply impulse
      if (invA > 0) {
        A.vx -= j * invA * nx;
        A.vy -= j * invA * ny;
      }
      if (invB > 0) {
        B.vx += j * invB * nx;
        B.vy += j * invB * ny;
      }
    }

    function trySeparateAxis(bodiesModule, A, B, dx, dy, maxTry) {
      // Move A and/or B along (dx,dy) by k cells until overlap clears.
      // Returns the k if successful, else 0. Leaves bodies at the successful position.
      const invA = A.invMass || 0;
      const invB = B.invMass || 0;

      if (invA === 0 && invB === 0) return 0;

      const ax0 = A.x, ay0 = A.y;
      const bx0 = B.x, by0 = B.y;

      function applyShift(k) {
        if (invA > 0 && invB > 0) {
          const aK = Math.floor(k / 2);
          const bK = k - aK;
          A.x = ax0 + (-dx * aK);
          A.y = ay0 + (-dy * aK);
          B.x = bx0 + ( dx * bK);
          B.y = by0 + ( dy * bK);
          snapBodyToCells(A);
          snapBodyToCells(B);
        } else if (invA > 0) {
          A.x = ax0 + (-dx * k);
          A.y = ay0 + (-dy * k);
          snapBodyToCells(A);
          B.x = bx0; B.y = by0;
        } else {
          B.x = bx0 + ( dx * k);
          B.y = by0 + ( dy * k);
          snapBodyToCells(B);
          A.x = ax0; A.y = ay0;
        }
      }

      for (let k = 1; k <= maxTry; k++) {
        applyShift(k);
        if (!anyOverlap(bodiesModule, A, B)) {
          return k; // success, positions already applied
        }
      }

      // restore if no success
      A.x = ax0; A.y = ay0;
      B.x = bx0; B.y = by0;
      return 0;
    }

    function resolvePairNoAABB(bodiesModule, A, B) {
      if (!A || !B) return;
      const invA = A.invMass || 0;
      const invB = B.invMass || 0;
      if (invA === 0 && invB === 0) return;

  

      if (!anyOverlap(bodiesModule, A, B)) return;

      // Try 4 directions; choose smallest separation that clears overlap.
      // We record the winning normal (dx,dy) for impulse.
      const trials = [
        { dx:  1, dy:  0 },
        { dx: -1, dy:  0 },
        { dx:  0, dy:  1 },
        { dx:  0, dy: -1 },
      ];

      const ax0 = A.x, ay0 = A.y;
      const bx0 = B.x, by0 = B.y;

      let bestK = 0;
      let bestDx = 0;
      let bestDy = 0;

      for (const t of trials) {
        // restore baseline
        A.x = ax0; A.y = ay0;
        B.x = bx0; B.y = by0;

        const k = trySeparateAxis(bodiesModule, A, B, t.dx, t.dy, MAX_SEP_TRY);
        if (k > 0 && (bestK === 0 || k < bestK)) {
          bestK = k;
          bestDx = t.dx;
          bestDy = t.dy;
        }
      }

      // Apply best separation for real
      A.x = ax0; A.y = ay0;
      B.x = bx0; B.y = by0;

      if (bestK > 0) {
        // Separate with exact bestK
        // (We call trySeparateAxis with maxTry=bestK so it lands on that solution.)
        trySeparateAxis(bodiesModule, A, B, bestDx, bestDy, bestK);

        // Convert separation direction into a collision normal.
        // The convention here: normal points from A toward B along the chosen axis.
        // With our separation shifts (A moves -dir, B moves +dir), this matches bestDx/bestDy.
        const nx = bestDx;
        const ny = bestDy;

        // Apply a normal impulse to cancel closing velocity along that normal.
        applyNormalImpulse(A, B, nx, ny);

        // Optional: if after impulse they're still trying to move into each other next frame,
        // keeping these helps stability in a grid world.
        if (nx !== 0) { if (invA) A.vx = 0; if (invB) B.vx = 0; }
        if (ny !== 0) { if (invA) A.vy = 0; if (invB) B.vy = 0; }
      } else {
        // Could not separate within limit; safety nudge upward
        if (DEBUG) console.warn("[physics] Could not separate pair within MAX_SEP_TRY", A.id, B.id);
        if (invA) { A.y -= 1; snapBodyToCells(A); A.vy = 0; }
        if (invB) { B.y -= 1; snapBodyToCells(B); B.vy = 0; }
      }
    }

    function step(world, bodiesModule, dt) {
      if (!dt || dt <= 0) return;

      const arr = bodiesModule.getBodies ? bodiesModule.getBodies() : null;
      if (!arr) throw new Error("[physics] bodies.getBodies() missing.");

      const floorY = getFloorY(world);

      // 1) Integrate (gravity)
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        if (!b || b.invMass === 0) continue;

        b.vy += GRAVITY * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        snapBodyToCells(b);
      }

      // 2) Ground
      for (let i = 0; i < arr.length; i++) {
        collideWithGround(arr[i], floorY);
      }

      // 3) Body-body solve (no AABB)
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

        // Keep ground valid after pushes
        for (let i = 0; i < arr.length; i++) {
          collideWithGround(arr[i], floorY);
        }
      }
    }

    return { step };
  }

  window.Physics = { createPhysics };
})();
