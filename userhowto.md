

# Primordia — Dev Testing (Local)

> Goal: start the stack, deploy a service, hit it directly and via Primordia’s proxy, and hot-swap code.

## 0) One-time

```bash
# From repo root
npm ci || npm i   # if you need node deps for local tools/scripts
```

---

## 1) Bring up the stack

```bash
# Start Primordia + emulators (compose files you already have)
./startl   # your helper (kills & restarts primordia container cleanly)
# or:
docker compose up -d
```

**Health check**

```bash
curl -sS http://localhost:8080/healthz
```

Expected: a happy “Primordia Bridge OK …”.

---

## 2) Quick environment sanity

```bash
# What’s running + port maps
docker compose ls
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

# Primordia env (proxy & emulators)
docker inspect primordia-primordia-1 --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | egrep -i 'PROXY|STORAGE|PUBSUB|PROJECT|ALLOW'

# Launcher env (topic/sub & emulators)
docker inspect local-launcher --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | egrep -i 'LOCAL_LAUNCHER_SUB|LOCAL_EVENTS_TOPIC|GOOGLE_CLOUD_PROJECT|PUBSUB_EMULATOR_HOST|WORKSPACE_BUCKET'
```

---

## 3) Seed a sample service (hot-swap-final)

```bash
# package.json
curl -sS -X POST http://localhost:8080/file -H 'content-type: application/json' -d @- <<'JSON'
{"path":"runs/hot-swap-final/package.json","content":"{\"name\":\"primordia-hot-swap-final\",\"type\":\"module\",\"dependencies\":{}}"}
JSON

# index.js (dynamic import on every request for easy hot-swap)
curl -sS -X POST http://localhost:8080/file -H 'content-type: application/json' -d @- <<'JSON'
{"path":"runs/hot-swap-final/index.js","content":"import http from 'http';const s=http.createServer(async(req,res)=>{if(req.url.startsWith('/hello')){const q=Date.now();const {default:handler}=await import(`./handler.js?ts=${q}`);return handler(req,res);}res.statusCode=404;res.end('Not Found');});s.listen(8080,()=>console.log('service listening :8080'));"} 
JSON

# handler.js (v1)
curl -sS -X POST http://localhost:8080/file -H 'content-type: application/json' -d @- <<'JSON'
{"path":"runs/hot-swap-final/handler.js","content":"export default (req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,message:'v1 from handler',t:new Date().toISOString()}));};"}
JSON
```

---

## 4) Deploy via Pub/Sub emulator

```bash
RUN_NAME=hot-swap-final
MSG=$(printf '{"type":"SERVICE_DEPLOYED","name":"%s"}' "$RUN_NAME" | base64 -w0)
curl -s -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"data\":\"$MSG\"}]}" \
  http://localhost:8083/v1/projects/ticktalk-472521/topics/primordia-builds:publish
```

**Find the mapped port & hit the service directly**

```bash
PORT=$(docker port primordia-local-service-$RUN_NAME 8080/tcp | sed 's/.*://')
echo "SERVICE_URL=http://127.0.0.1:$PORT"
curl -sS "http://127.0.0.1:$PORT/hello"
```

Expected: `{"ok":true,"message":"v1 from handler",...}`

---

## 5) Call through Primordia’s proxy (agent path)

Make sure Primordia allows your service origin:

```bash
# (Optional) set exact origin allowlist if needed
cat > docker-compose.proxy.override.yml <<'YML'
services:
  primordia:
    environment:
      PROXY_ALLOWLIST: 'http://primordia-local-service-hot-swap-final:8080'
YML
docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.proxy.override.yml up -d primordia
```

**Proxy call**

```bash
curl -sS -X POST http://localhost:8080/workspace/proxy \
  -H 'content-type: application/json' \
  -d '{"url":"http://primordia-local-service-hot-swap-final:8080/hello","method":"GET"}'
```

Expected: `{"ok":true,"status":200,...,"body":{"value":"{\"ok\":true,...}"}}`

---

## 6) Live hot-swap (no redeploy)

```bash
# Write new handler (v2)
curl -sS -X POST http://localhost:8080/file -H 'content-type: application/json' -d @- <<'JSON'
{"path":"runs/hot-swap-final/handler.js","content":"export default (req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,message:'v2 LIVE swap',t:new Date().toISOString()}));};"}
JSON

# Same container, same port
curl -sS -X POST http://localhost:8080/workspace/proxy \
  -H 'content-type: application/json' \
  -d '{"url":"http://primordia-local-service-hot-swap-final:8080/hello","method":"GET"}'
```

Expected: `"message":"v2 LIVE swap"`.

---

## 7) Logs (fast feedback)

```bash
# Primordia API + Worker
docker logs --tail=120 primordia-primordia-1

# Launcher (deploy activity & docker run)
docker logs --tail=120 local-launcher

# Service container (if needed)
docker logs --tail=120 primordia-local-service-hot-swap-final
```

---

## 8) Troubleshooting cheats

* **Launcher crash: `ALREADY_EXISTS`**
  Use a fresh sub name: update `LOCAL_LAUNCHER_SUB` (e.g., `...-3`), then:

  ```bash
  docker compose up -d local-launcher
  ```
* **Service started but no port**
  Ensure launcher `docker run` uses `-p 0:8080` (this is already fixed in your code).
* **Proxy says `Origin not allowed`**
  Add exact origin to `PROXY_ALLOWLIST` (comma-separated) and `docker compose up -d primordia`.
* **`gcloud` auth nags**
  Use emulator **REST** endpoints (as shown) for publish/pull/list.

---

## 9) Clean up

```bash
# Stop just the service container
docker rm -f primordia-local-service-hot-swap-final 2>/dev/null || true

# Stop everything
docker compose down
```

---

## 10) Quick “all-green” micro-checklist

* `/healthz` returns OK
* Deploy publish returns a messageId
* `docker port primordia-local-service-<name> 8080/tcp` shows a host port
* `/workspace/proxy` → status 200 and correct JSON
* Hot-swap `handler.js` reflects on next `/hello`

