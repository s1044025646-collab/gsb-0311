const { Store } = require("../dist/src/db.js");
const { startServer } = require("../dist/src/api.js");
(async () => {
  const store = new Store("data/smoke.db");
  const { server, port } = await startServer(store, 0);
  const base = `http://localhost:${port}`;
  const post = await fetch(`${base}/api/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gas: { n: 1, gamma: 1.4 },
      initial: { T: 300, V: 0.001 },
      processes: [{ type: "isothermal", V2: 0.002 }],
    }),
  });
  const created = await post.json();
  console.log("POST", post.status, "id", created.id, "W", created.report.totals.W.toFixed(4));
  const seg = await (await fetch(`${base}/api/analyses/${created.id}/segments/0`)).json();
  console.log("SEG invariant:", seg.segment.invariant);
  const clo = await (await fetch(`${base}/api/analyses/${created.id}/closure`)).json();
  console.log("CLOSURE closed:", clo.closure.closed);
  const bad = await fetch(`${base}/api/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gas: { n: 1, gamma: 1.4 },
      initial: { T: 300, V: 0.001 },
      processes: [{ type: "bogus", V2: 1 }],
    }),
  });
  console.log("BAD", bad.status, JSON.stringify((await bad.json()).error));
  const cmp = await (await fetch(`${base}/api/compare?ids=${created.id},${created.id}`)).json();
  console.log("COMPARE analyses:", cmp.analyses.length);
  const exp = await (await fetch(`${base}/api/analyses/${created.id}/export`)).json();
  console.log("EXPORT version:", exp.constants_version);
  server.close();
  store.close();
  require("fs").rmSync("data/smoke.db", { force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
