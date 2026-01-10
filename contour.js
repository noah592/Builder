(() => {
  // Contour extraction for grid-occupancy bodies.
  //
  // Output: one or more closed loops per body, each loop is an array of points {x,y}
  // in WORLD coordinates. Points lie on cell boundaries (integer grid lines).
  //
  // This is a robust "boundary edge trace" approach:
  // - For each solid cell, emit its boundary edges where neighbor is empty.
  // - Then stitch edges into loops.
  //
  // Later, we can add smoothing (Chaikin) and/or marching-squares iso-lines.

  function createContour(bodies) {
    if (!bodies) throw new Error("[contour] bodies module is required.");

    if (typeof bodies.hasSolidAtWorld !== "function") {
      throw new Error("[contour] bodies.hasSolidAtWorld(body,x,y) is missing.");
    }

    function ptKey(x, y) {
      return `${x},${y}`;
    }

    function edgeKey(ax, ay, bx, by) {
      return `${ax},${ay}|${bx},${by}`;
    }

    function addAdj(map, a, b) {
      const ka = ptKey(a.x, a.y);
      const kb = ptKey(b.x, b.y);

      let sa = map.get(ka);
      if (!sa) map.set(ka, (sa = new Set()));
      sa.add(kb);

      let sb = map.get(kb);
      if (!sb) map.set(kb, (sb = new Set()));
      sb.add(ka);
    }

    function getBounds(body) {
      // Use body's current bounds; contour will be correct if bounds are tight-ish.
      // Works even if loose; just slower.
      const x0 = Math.floor(body.x);
      const y0 = Math.floor(body.y);
      return {
        x0,
        y0,
        x1: x0 + (body.w | 0),
        y1: y0 + (body.h | 0),
      };
    }

    function computeContoursForBody(body) {
      // Returns: { loops: Array<Array<{x,y}>>, edgeCount }
      const loops = [];

      if (!body || !body.mass) return { loops, edgeCount: 0 };

      const { x0, y0, x1, y1 } = getBounds(body);

      // 1) Collect boundary edges as undirected segments between grid points.
      //    For each solid cell (x,y), its square is [x,x+1]x[y,y+1].
      //    If neighbor in a direction is empty, that side is a boundary edge.
      const adj = new Map();       // pointKey -> Set(pointKey)
      const points = new Map();    // pointKey -> {x,y} (store actual)
      let edgeCount = 0;

      function getPoint(x, y) {
        const k = ptKey(x, y);
        let p = points.get(k);
        if (!p) {
          p = { x, y };
          points.set(k, p);
        }
        return p;
      }

      // To avoid double-adding edges, we can just add them as we find them
      // because each boundary edge belongs to exactly one solid cell when neighbor is empty.
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (!bodies.hasSolidAtWorld(body, x, y)) continue;

          const leftEmpty  = !bodies.hasSolidAtWorld(body, x - 1, y);
          const rightEmpty = !bodies.hasSolidAtWorld(body, x + 1, y);
          const upEmpty    = !bodies.hasSolidAtWorld(body, x, y - 1);
          const downEmpty  = !bodies.hasSolidAtWorld(body, x, y + 1);

          // Each edge is between two corner points
          if (leftEmpty) {
            const a = getPoint(x, y);
            const b = getPoint(x, y + 1);
            addAdj(adj, a, b);
            edgeCount++;
          }
          if (rightEmpty) {
            const a = getPoint(x + 1, y);
            const b = getPoint(x + 1, y + 1);
            addAdj(adj, a, b);
            edgeCount++;
          }
          if (upEmpty) {
            const a = getPoint(x, y);
            const b = getPoint(x + 1, y);
            addAdj(adj, a, b);
            edgeCount++;
          }
          if (downEmpty) {
            const a = getPoint(x, y + 1);
            const b = getPoint(x + 1, y + 1);
            addAdj(adj, a, b);
            edgeCount++;
          }
        }
      }

      if (edgeCount === 0) return { loops, edgeCount: 0 };

      // 2) Trace loops from adjacency.
      // Each boundary vertex in a manifold boundary should have degree 2.
      // We'll walk edges greedily, removing them as we go.

      // Helper: remove undirected edge (ka <-> kb)
      function removeEdge(ka, kb) {
        const sa = adj.get(ka);
        if (sa) {
          sa.delete(kb);
          if (sa.size === 0) adj.delete(ka);
        }
        const sb = adj.get(kb);
        if (sb) {
          sb.delete(ka);
          if (sb.size === 0) adj.delete(kb);
        }
      }

      // Get any remaining point key
      function anyKey() {
        for (const k of adj.keys()) return k;
        return null;
      }

      // Convert key to point
      function keyToPoint(k) {
        return points.get(k);
      }

      while (adj.size > 0) {
        const startK = anyKey();
        if (!startK) break;

        // Pick one neighbor to start the walk
        const startNeighbors = adj.get(startK);
        const firstNeighborK = startNeighbors.values().next().value;

        const loop = [];
        let prevK = null;
        let curK = startK;
        let nextK = firstNeighborK;

        loop.push({ x: keyToPoint(curK).x, y: keyToPoint(curK).y });

        // Walk until we return to start
        // Hard guard to prevent infinite loops on non-manifold data
        let guard = 0;
        const GUARD_MAX = edgeCount * 4 + 100;

        while (guard++ < GUARD_MAX) {
          // consume edge cur<->next
          removeEdge(curK, nextK);

          prevK = curK;
          curK = nextK;

          loop.push({ x: keyToPoint(curK).x, y: keyToPoint(curK).y });

          if (curK === startK) {
            break; // closed
          }

          const nset = adj.get(curK);
          if (!nset || nset.size === 0) {
            // open boundary (shouldn't happen in solid regions)
            break;
          }

          // choose next neighbor != prevK if possible
          let candidate = null;
          for (const k of nset) {
            if (k !== prevK) {
              candidate = k;
              break;
            }
          }
          // If degree-1 corner, just go back
          nextK = candidate !== null ? candidate : nset.values().next().value;
        }

        // Only accept loops with >= 4 points and closed
        if (loop.length >= 4) loops.push(loop);
      }

      return { loops, edgeCount };
    }

    function updateBodyContours(body) {
      const res = computeContoursForBody(body);
      body.contours = res.loops;
      body.contourEdgeCount = res.edgeCount;
      return res;
    }

    function updateAll() {
      const list = bodies.getBodies ? bodies.getBodies() : null;
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        updateBodyContours(list[i]);
      }
    }

    function drawDebug(ctx, cam) {
      const list = bodies.getBodies ? bodies.getBodies() : null;
      if (!list) return;

      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#0f0"; // green outline for visibility
      ctx.fillStyle = "rgba(0,255,0,0.08)";

      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const contours = b.contours;
        if (!contours || contours.length === 0) continue;

        for (const loop of contours) {
          if (!loop || loop.length < 2) continue;

          ctx.beginPath();
          for (let k = 0; k < loop.length; k++) {
            const p = loop[k];
            const sx = (p.x - cam.x) * cam.z;
            const sy = (p.y - cam.y) * cam.z;
            if (k === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    return {
      computeContoursForBody,
      updateBodyContours,
      updateAll,
      drawDebug,
    };
  }

  window.Contour = { createContour };
})();
