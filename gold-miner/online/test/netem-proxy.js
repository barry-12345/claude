'use strict';
// TCP proxy for tests: browser <-> proxy <-> online server.  Adds delay / jitter (order kept) and can black-hole the traffic
// (bytes are swallowed, connections stay open: a "half-open" connection as after a NAT drop or a sleeping laptop).
//   const p = await startProxy({ target: 8790 }); p.port; p.set({ delay: 50, jitter: 20, blackhole: true }); await p.close();
//   CLI: node test/netem-proxy.js <listenPort> <targetPort> [delayMs] [jitterMs]
const net = require('net');

function startProxy(opts = {}) {
  const st = { delay: opts.delay || 0, jitter: opts.jitter || 0, blackhole: !!opts.blackhole };
  const socks = new Set();
  const pipe = (from, to) => {
    let last = 0;
    from.on('data', buf => {
      if (st.blackhole) return;                                  // swallowed
      const d = st.delay + (Math.random() * 2 - 1) * st.jitter;
      if (d <= 0 && !last) { to.write(buf); return; }
      const now = Date.now(), at = Math.max(now + Math.max(0, d), last); last = at;
      setTimeout(() => { if (!to.destroyed && !st.blackhole) to.write(buf); }, at - now);
    });
  };
  const server = net.createServer(client => {
    const up = net.connect(opts.target, opts.targetHost || '127.0.0.1');
    socks.add(client); socks.add(up);
    pipe(client, up); pipe(up, client);
    const end = () => {
      if (st.blackhole) return;                                  // black hole: a close is swallowed too (the far side never learns)
      client.destroy(); up.destroy(); socks.delete(client); socks.delete(up);
    };
    client.on('error', end); up.on('error', end); client.on('close', end); up.on('close', end);
    client.on('end', end); up.on('end', end);
  });
  return new Promise(resolve => server.listen(opts.port || 0, '127.0.0.1', () => resolve({
    port: server.address().port,
    set(o) { Object.assign(st, o); },
    state: st,
    close() { for (const s of socks) s.destroy(); return new Promise(r => server.close(() => r())); },
  })));
}

module.exports = { startProxy };

if (require.main === module) {
  const [lp, tp, d, j] = process.argv.slice(2).map(Number);
  startProxy({ port: lp, target: tp, delay: d || 0, jitter: j || 0 }).then(p => console.log(`netem proxy 127.0.0.1:${p.port} -> 127.0.0.1:${tp}`));
}
