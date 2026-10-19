// Local collector for debug builds. Appends every batch the extension sends
// to telemetry.jsonl, one JSON object per line.
//   node telemetry-server.js            # listens on 127.0.0.1:8787
const http = require("http");
const fs = require("fs");

const PORT = Number(process.env.PORT || 8787);
const OUT = process.env.OUT || "telemetry.jsonl";

http
  .createServer((req, res) => {
    if (req.method !== "POST") return res.writeHead(404).end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const batch = JSON.parse(body);
        fs.appendFileSync(OUT, JSON.stringify(batch) + "\n");
        const n = (batch.debug?.length || 0) + (batch.log?.length || 0);
        console.log(new Date().toISOString(), `${n} events`);
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`collecting into ${OUT} on :${PORT}`));
