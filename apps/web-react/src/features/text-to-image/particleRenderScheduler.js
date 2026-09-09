// One drawing callback per page. Hidden and paused surfaces never enter this pool.
export function particleRenderQuality(activeCount, pressure = 0) {
  const count = Math.max(1, activeCount);
  const factor = pressure ? 0.65 : 1;
  return {
    particles: Math.min(Math.floor(2400 * factor), Math.floor(8000 * factor / count)),
    pixels: Math.floor(2_000_000 * factor / count),
    dpr: pressure ? 1.15 : 1.5,
    fps: pressure || count > 8 ? 20 : count > 4 ? 24 : 30,
    glows: count > 8 || pressure ? 6 : 16,
  };
}

export function createParticleRenderScheduler(ticker, measure = () => performance.now()) {
  const clients = new Set();
  let listening = false, pressure = 0, slowFrames = 0, fastFrames = 0;
  let averageMs = 0, maxMs = 0, frames = 0;

  function rebalance() {
    const active = [...clients].filter(client => client.active);
    const quality = particleRenderQuality(active.length, pressure);
    for (const client of active) {
      if (JSON.stringify(client.quality) !== JSON.stringify(quality)) {
        client.quality = quality;
        client.configure(quality);
      }
    }
    if (Boolean(active.length) !== listening) {
      listening = Boolean(active.length);
      if (listening) ticker.add(frame);
      else ticker.remove(frame);
    }
  }

  function frame(time) {
    const begin = measure();
    let rendered = 0;
    for (const client of clients) {
      if (!client.active) continue;
      const interval = 1 / client.quality.fps;
      if (client.lastFrame !== null && time - client.lastFrame < interval - 0.0005) continue;
      const delta = client.lastFrame === null ? interval : Math.min(0.1, time - client.lastFrame);
      client.lastFrame = time;
      client.draw(delta);
      rendered++;
    }
    if (!rendered) return;
    const elapsed = measure() - begin;
    frames++;
    averageMs = frames === 1 ? elapsed : averageMs * 0.92 + elapsed * 0.08;
    maxMs = Math.max(maxMs, elapsed);
    slowFrames = elapsed > 7 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    fastFrames = averageMs < 3 ? fastFrames + 1 : 0;
    if (!pressure && slowFrames >= 12) { pressure = 1; slowFrames = 0; rebalance(); }
    else if (pressure && fastFrames >= 240) { pressure = 0; fastFrames = 0; rebalance(); }
  }

  return {
    register({ draw, configure, metrics = () => ({}) }) {
      const client = { draw, configure, metrics, active: false, lastFrame: null, quality: null };
      clients.add(client);
      let disposed = false;
      return {
        setActive(active) {
          if (disposed || client.active === active) return;
          client.active = active;
          client.lastFrame = null;
          client.quality = null;
          rebalance();
        },
        destroy() {
          if (disposed) return;
          disposed = true;
          clients.delete(client);
          rebalance();
        },
      };
    },
    snapshot() {
      const rows = [...clients].map(client => ({ ...client.metrics(), active: client.active }));
      const active = rows.filter(row => row.active).length;
      return {
        active, registered: rows.length, callbacks: listening ? 1 : 0,
        targetFps: active ? particleRenderQuality(active, pressure).fps : 0,
        particles: rows.reduce((sum, row) => sum + (row.particles || 0), 0),
        canvasPixels: rows.reduce((sum, row) => sum + (row.canvasPixels || 0), 0),
        renderedFrames: rows.reduce((sum, row) => sum + (row.frames || 0), 0),
        averageDrawMs: Number(averageMs.toFixed(2)), maxDrawMs: Number(maxMs.toFixed(2)), pressure,
      };
    },
  };
}
