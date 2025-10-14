#!/usr/bin/env bash
set -euo pipefail
NAME="${1:-svc1}"

# Node script talks to Docker Engine via UNIX socket (no docker CLI / curl required).
node - <<'NODE' "$NAME"
/* args[0] = service name */
const NAME = process.argv[2] || 'svc1';
const http = require('http');
const socketPath = '/var/run/docker.sock';

function dock(method, path, body, headers={}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(body) : null;
    const req = http.request(
      { socketPath, path, method, headers: { ...(data ? { 'Content-Type':'application/json','Content-Length':data.length } : {}), ...headers } },
      res => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  // 1) Ensure base image exists (pull if missing)
  //    Docker API: POST /images/create?fromImage=node&tag=20-alpine
  await dock('POST', '/images/create?fromImage=node&tag=20-alpine');

  // 2) Remove any old container with same name
  await dock('DELETE', `/containers/${encodeURIComponent(NAME)}?force=true`).catch(()=>{});

  // 3) Create container: expose 8080/tcp, request random host port binding, join primordia_default network
  const createBody = JSON.stringify({
    Image: 'node:20-alpine',
    ExposedPorts: { '8080/tcp': {} },
    HostConfig: { NetworkMode: 'primordia_default', PortBindings: { '8080/tcp': [ {} ] } },
    Env: [ `SERVICE_NAME=${NAME}`, 'PORT=8080' ],
    Cmd: ['sh','-lc',`
cat >/server.mjs <<'JS'
import http from 'http';
const PORT = process.env.PORT||8080;
const NAME = process.env.SERVICE_NAME||'svc';
http.createServer((req,res)=>{
  if (req.url==='/healthz'){res.writeHead(200);return res.end('ok');}
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({service:NAME,path:req.url}));
}).listen(PORT, ()=>console.log('svc',NAME,'listening',PORT));
JS
node /server.mjs
`]
  });

  const created = await dock('POST', `/containers/create?name=${encodeURIComponent(NAME)}`, createBody);
  if (created.status >= 400) throw new Error(`create failed: ${created.body}`);
  const cid = JSON.parse(created.body).Id;
  if (!cid) throw new Error('create returned no Id');

  // 4) Start container
  const started = await dock('POST', `/containers/${cid}/start`);
  if (started.status >= 300) throw new Error(`start failed: ${started.body}`);

  // 5) Inspect to find chosen host port
  const insp = await dock('GET', `/containers/${cid}/json`);
  if (insp.status >= 300) throw new Error(`inspect failed: ${insp.body}`);
  const info = JSON.parse(insp.body);
  const ports = info?.NetworkSettings?.Ports?.['8080/tcp'];
  const hostPort = ports && ports[0] && ports[0].HostPort;
  if (!hostPort) throw new Error('no host port mapped');

  console.log(`STARTED ${NAME} on http://localhost:${hostPort} (container :8080)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
NODE
