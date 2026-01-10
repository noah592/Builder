(() => {
  function createPhysics(opts = {}) {
    // Gravity in world-units / second^2.
    // Positive Y is "down" in your world (based on your camera/floor conventions).
    const g = typeof opts.gravity === "number" ? opts.gravity : 2000;

    function updateAABB(b) {
      // Keep consistent with bodies.js:
      // aabb covers [x, x+w] and [y, y+h] in world coords.
      if (!b.aabb) b.aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      b.aabb.minX = b.x;
      b.aabb.minY = b.y;
      b.aabb.maxX = b.x + b.w;
      b.aabb.maxY = b.y + b.h;
    }

    function step(world, bodiesModule, dt) {
      // dt in seconds
      if (!dt || dt <= 0) return;

      // bodiesModule is the object returned from Bodies.createBodies().
      // We need access to its internal list; since it's encapsulated,
      // we step by asking it for ids or exposing a list.
      //
      // Minimal approach: bodies.js should expose a "forEachBody" iterator.
      // BUT since you don't have that yet, we can still integrate by stepping
      // via a small optional hook: bodiesModule._debugGetBodies?.()
      //
      // To keep this module usable now, we support both:
      // 1) bodiesModule.getBodies() -> returns array reference
      // 2) bodiesModule._debugGetBodies() -> returns array reference
      // If neither exists, we can't step.

      const arr =
        (typeof bodiesModule.getBodies === "function" && bodiesModule.getBodies()) ||
        (typeof bodiesModule._debugGetBodies === "function" && bodiesModule._debugGetBodies());

      if (!arr) {
        // Fail loudly in dev so wiring gets fixed immediately
        console.warn(
          "[physics] No body array access. Add bodies.getBodies() or bodies._debugGetBodies()."
        );
        return;
      }

      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];

        // Treat invMass === 0 as static / infinite mass
        if (!b || !b.invMass) continue;

        // Ensure state exists
        if (typeof b.vx !== "number") b.vx = 0;
        if (typeof b.vy !== "number") b.vy = 0;
        if (typeof b.fx !== "number") b.fx = 0;
        if (typeof b.fy !== "number") b.fy = 0;

        // Forces: gravity + any accumulated external forces
        // a = F * invMass
        const ax = b.fx * b.invMass;
        const ay = (b.fy * b.invMass) + g;

        // Semi-implicit Euler (stable enough, standard for games)
        b.vx += ax * dt;
        b.vy += ay * dt;

        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // Clear forces each step (so callers accumulate per-frame)
        b.fx = 0;
        b.fy = 0;

        updateAABB(b);
      }
    }

    return { step };
  }

  window.Physics = { createPhysics };
})();
