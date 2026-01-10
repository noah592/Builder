(() => {
  function createPhysics(opts = {}) {
    // Gravity in world-units / second^2 (positive Y = down)
    const GRAVITY = typeof opts.gravity === "number" ? opts.gravity : 2000;

    // Solver iterations for body-body (more = less interpenetration / better stacking)
    const SOLVER_ITERS = typeof opts.solverIters === "number" ? opts.solverIters : 3;

    // Small penetration slop to reduce jitter
    const SLOP = typeof opts.slop === "number" ? opts.slop : 0.5;

    // How aggressively we correct penetration (0..1)
    const POS_CORR = typeof opts.posCorr === "number" ? opts.posCorr : 1.0;

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
  // Prefer explicit world property / getter if you have it
  if (world && typeof world.getFloorY === "function") return world.getFloorY();

  // Your world.js uses groundY
  if (world && typeof world.groundY === "number") return world.groundY;

  // Older/alternate naming
  if (world && typeof world.floorY === "number") return world.floorY;

  // Fallback to convention
  if (world && typeof world.height === "number") return world.height - world.height / 5;

  return 0;
}

    // ---------------------------------------------------------
    // Ground collision: clamp body bottom to floor plane
    // ---------------------------------------------------------
    function collideWithGround(b, floorY) {
      // Only for dynamic bodies
      if (!b || b.invMass === 0) return;

      const bottom = b.y + b.h;
      const pen = bottom - floorY;

      if (pen > 0) {
        // Positional correction
        b.y -= pen;

        // Cancel downward velocity
        if (b.vy > 0) b.vy = 0;

        updateAABB(b);
      }
    }

    // ---------------------------------------------------------
    // Body-body AABB collision: compute minimum translation vector
    // ---------------------------------------------------------
    function resolveAABBPair(A, B) {
      if (!A || !B) return;
      if (A.invMass === 0 && B.invMass === 0) return;

      const a = A.aabb;
      const b = B.aabb;
      if (!a || !b) return;

      if (!aabbOverlap(a, b)) return;

      // Overlaps (positive)
      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);

      // Choose axis of least penetration
      let nx = 0, ny = 0, sep = 0;

      if (overlapX < overlapY) {
        // Separate along X
        sep = overlapX;
        // Determine direction from centers
        const aCx = (a.minX + a.maxX) * 0.5;
        const bCx = (b.minX + b.maxX) * 0.5;
        nx = aCx < bCx ? -1 : 1; // push A left if A is left of B, else right
        ny = 0;
      } else {
        // Separate along Y
        sep = overlapY;
        const aCy = (a.minY + a.maxY) * 0.5;
        const bCy = (b.minY + b.maxY) * 0.5;
        nx = 0;
        ny = aCy < bCy ? -1 : 1; // push A up if A is above B, else down
      }

      // Apply slop + correction factor
      const corrected = Math.max(0, sep - SLOP) * POS_CORR;
      if (corrected <= 0) return;

      const invA = A.invMass || 0;
      const invB = B.invMass || 0;
      const invSum = invA + invB;
      if (invSum <= 0) return;

      // Split positional correction by inverse mass
      const moveA = corrected * (invA / invSum);
      const moveB = corrected * (invB / invSum);

      // Move bodies apart (A opposite normal, B along normal)
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

      // Velocity correction: cancel relative velocity into the normal
      // Compute relative velocity along normal
      const rvx = (B.vx || 0) - (A.vx || 0);
      const rvy = (B.vy || 0) - (A.vy || 0);
      const relN = rvx * nx + rvy * ny;

      // If separating already, don't do anything
      if (relN >= 0) return;

      // Simple impulse with restitution = 0 for now (inelastic)
      // j = -(relN) / (invA + invB)
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

      // 1) Integrate forces (gravity only for now)
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

      // 2) Ground collision (after integration)
      for (let i = 0; i < arr.length; i++) {
        collideWithGround(arr[i], floorY);
      }

      // 3) Body-body collisions (AABB only)
      // Multiple iterations improves stacking stability a lot.
      for (let iter = 0; iter < SOLVER_ITERS; iter++) {
        for (let i = 0; i < arr.length; i++) {
          const A = arr[i];
          if (!A) continue;

          for (let j = i + 1; j < arr.length; j++) {
            const B = arr[j];
            if (!B) continue;

            // Skip if both static
            if ((A.invMass === 0) && (B.invMass === 0)) continue;

            // Broad + narrow (AABB overlap only)
            if (!A.aabb || !B.aabb) {
              updateAABB(A);
              updateAABB(B);
            }

            if (aabbOverlap(A.aabb, B.aabb)) {
              resolveAABBPair(A, B);
            }
          }
        }

        // After resolving pairs, also re-apply ground to prevent sinking due to pair pushes
        for (let i = 0; i < arr.length; i++) {
          collideWithGround(arr[i], floorY);
        }
      }
    }

    return { step };
  }

  window.Physics = { createPhysics };
})();
