(() => {
  function createRenderer({ version }) {
    function beginFrame(ctx, canvas) {
      const rect = canvas.getBoundingClientRect();
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, rect.width, rect.height);
    }

    function drawVersion(ctx) {
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.font = "14px system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(`RUNNING: ${version}`, 10, 10);
      ctx.restore();
    }

    return { beginFrame, drawVersion };
  }

  window.Renderer = { createRenderer };
})();
