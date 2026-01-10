(() => {
  function createCentroid(bodies) {
    if (!bodies) throw new Error("[centroid] bodies module is required.");

    function computeCentroidOfBody(body) {
      // If empty/no mass, default to center of its AABB-ish bounds
      const m = body && typeof body.mass === "number" ? body.mass : 0;
      if (!body || m <= 0) {
        const cx = body ? body.x + body.w * 0.5 : 0;
        const cy = body ? body.y + body.h * 0.5 : 0;
        return { x: cx, y: cy };
      }

      if (typeof bodies.forEachSolidCellWorld !== "function") {
        throw new Error(
          "[centroid] bodies.forEachSolidCellWorld(body, fn) is missing. " +
            "Expose it from bodies.js (Option A)."
        );
      }

      let sumX = 0;
      let sumY = 0;
      let count = 0;

      // Each solid cell contributes its center (wx+0.5, wy+0.5)
      bodies.forEachSolidCellWorld(body, (wx, wy) => {
        sumX += wx + 0.5;
        sumY += wy + 0.5;
        count++;
      });

      if (count <= 0) {
        // Shouldn't happen if mass is correct, but guard anyway
        return { x: body.x + body.w * 0.5, y: body.y + body.h * 0.5 };
      }

      return { x: sumX / count, y: sumY / count };
    }

    function updateBodyCentroid(body) {
      const c = computeCentroidOfBody(body);
      body.cx = c.x;
      body.cy = c.y;
      return c;
    }

    function updateAll() {
      const list = bodies.getBodies ? bodies.getBodies() : null;
      if (!list) return;

      for (let i = 0; i < list.length; i++) {
        updateBodyCentroid(list[i]);
      }
    }

    // Optional helper if you want to draw/debug centroids later
    function drawDebug(ctx, cam, radius = 4) {
      const list = bodies.getBodies ? bodies.getBodies() : null;
      if (!list) return;

      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (typeof b.cx !== "number" || typeof b.cy !== "number") continue;

        const sx = (b.cx - cam.x) * cam.z;
        const sy = (b.cy - cam.y) * cam.z;

        // Keep it crisp-ish without messing with your renderer style:
        const r = radius;

        ctx.save();
        ctx.fillStyle = "#f00";
        ctx.fillRect(Math.floor(sx - r), Math.floor(sy - r), r * 2, r * 2);
        ctx.restore();
      }
    }

    return {
      computeCentroidOfBody,
      updateBodyCentroid,
      updateAll,
      drawDebug,
    };
  }

  window.Centroid = { createCentroid };
})();
