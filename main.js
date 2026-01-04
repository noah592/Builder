const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: false });

const circles = [];

let placing = false;
let center = { x: 0, y: 0 };
let radius = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function mousePos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function clear() {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawFilledCircle(x, y, r) {
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawPreviewCircle(x, y, r) {
  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCenterDot(x, y) {
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
}

function draw() {
  clear();

  // finalized circles (solid)
  for (const c of circles) {
    drawFilledCircle(c.x, c.y, c.r);
  }

  // preview
  if (placing) {
    drawCenterDot(center.x, center.y);
    drawPreviewCircle(center.x, center.y, radius);
  }
}

canvas.addEventListener("click", (e) => {
  const p = mousePos(e);

  if (!placing) {
    center = p;
    radius = 0;
    placing = true;
  } else {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const r = Math.hypot(dx, dy);

    if (r > 1) {
      circles.push({ x: center.x, y: center.y, r });
    }

    placing = false;
    radius = 0;
  }

  draw();
});

canvas.addEventListener("mousemove", (e) => {
  if (!placing) return;
  const p = mousePos(e);
  radius = Math.hypot(p.x - center.x, p.y - center.y);
  draw();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    placing = false;
    radius = 0;
    draw();
  }

  if (e.key === "Backspace") {
    e.preventDefault();
    circles.pop();
    draw();
  }
});

window.addEventListener("resize", resize);
resize();
