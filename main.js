(() => {
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");

  const circles = []; // finalized: {x,y,r}

  let placing = false;
  let center = { x: 0, y: 0 };
  let previewR = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    // Draw using CSS pixel coordinates
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function getMouse(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function clear() {
    // Clear in CSS pixel space (since we scaled via setTransform)
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
  }

  function drawFinalCircle(c) {
    ctx.save();
    ctx.setLineDash([]);          // ensure no dashes leak in
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();                   // <-- SOLID FILL
    ctx.restore();
  }

  function drawPreviewCircle(x, y, r) {
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawCenterDot(x, y) {
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    clear();

    // finalized circles = FILLED
