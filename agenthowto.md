

# Primordia — Agent Instructions (Local)

> Goal: let an agent reliably **deploy**, **use**, and **hot-swap** a service in the local Primordia stack, including calling it **through Primordia’s proxy**.

## 0) Mental model

* **Primordia** (API + worker) runs on **[http://localhost:8080](http://localhost:8080)**.
* **Emulators**: Pub/Sub `localhost:8083`, fake-GCS (HTTP) `localhost:4443`, Firestore emulator (container `firestore:8080`).
* **Launcher** listens on a Pub/Sub topic and, on `SERVICE_DEPLOYED`, runs a child container:

  * Container name: `primordia-local-service-<run-name>`
  * Port mapping: **`-p 0:8080`** (random host port → container `:8080`)
* **Proxy**: agents call services *through Primordia* via `POST /workspace/proxy` with an allowlist.

---

## 1) One-time prerequisites (already baked if you’ve been following along)

Make sure these envs exist on the **launcher** container:

```
PUBSUB_EMULATOR_HOST=pubsub:8083
LOCAL_EVENTS_TOPIC=primordia-builds
LOCAL_LAUNCHER_SUB=primordia-local-launcher-sub-2  # or any unique sub
GOOGLE_CLOUD_PROJECT=ticktalk-472521
GCLOUD_PROJECT=ticktalk-472521
WORKSPACE_BUCKET=primordia-bucket
```

Make sure these envs exist on the **Primordia** container:

```
PROJECT_ID=ticktalk-472521
PUBSUB_EMULATOR_HOST=pubsub:8083
STORAGE_EMULATOR_HOST=http://gcs:4443
PROXY_ALLOWLIST=http://primordia-local-service-<name>:8080   # literal match (not regex)
```

> To allow multiple services, set `PROXY_ALLOWLIST` to a comma-separated list, e.g.
> `PROXY_ALLOWLIST='http://primordia-local-service-foo:8080,http://primordia-local-service-bar:8080'`

---

## 2) Fresh start (safe, idempotent)

```bash
# Restart Primordia + emulators (does not nuke data)
docker compose up -d

# Confirm Primordia is healthy
curl -sS http://localhost:8080/healthz
```

Expected: a success message (Primordia Bridge OK).

---

## 3) Seed service files (agent-friendly)

> Agents should always (re)write the three files below before a deploy.

```bash
# Write package.json
curl -sS -X POST http://localhost:8080/file -H 'content-type: application/json' -d @- <<'JSON'
{ "path": "runs/hot-swap-final/package.json",
  "content": "{\"name\":\"primordia-hot-swap-final\",\"type\":\"module\",\"dependencies\":{}}"
}
JSON

# Write index.js (baseline that imports handler per request; safe to reuse)
curl -sS -X POST http://localhost:8080/file -H 'content-type: application/json' -d @- <<'JSON'
{
  "path": "runs/hot-swap-final/index.js",
  "content": "// minimal index: dynamic import every request\nimport http from 'http';\nconst server = http.createServer(async (req, res) => {\n  if (req.url.startsWith('/hello')) {\n    const q = Date.now();\n    const { default: handler } = await import(`./handler.js?ts=${q}`);\n    return handler(req, res);\n  }\n  res.statusCode = 404; res.end('Not Found');\n});\nserver.listen(8080, () => console.log('service listening :8080'));"
}
JSON

# Write handler.js (the “business logic” you hot-swap)
curl -sS -X POST http://localhost:8080/file -H 'content-type: application/json' -d @- <<'JSON'
{
  "path": "runs/hot-swap-final/handler.js",
  "content": "export default (req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,message:'v1 from handler',t:new Date().toISOString()}));};"
}
JSON
```

---

## 4) Deploy the service (agent action)

> The launcher reacts to this message and runs the service container with a published port.

**Publish to Pub/Sub emulator (auth-free REST):**

```bash
RUN_NAME=hot-swap-final
MSG=$(printf '{"type":"SERVICE_DEPLOYED","name":"%s"}' "$RUN_NAME" | base64 -w0)
curl -s -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"data\":\"$MSG\"}]}" \
  http://localhost:8083/v1/projects/ticktalk-472521/topics/primordia-builds:publish
```

**Discover the host port & probe directly (human sanity check):**

```bash
PORT=$(docker port primordia-local-service-$RUN_NAME 8080/tcp | sed 's/.*://')
echo "SERVICE_URL=http://127.0.0.1:$PORT"
curl -sS "http://127.0.0.1:$PORT/hello"
```

Expected: `{"ok":true,"message":"v1 from handler",...}`

---

## 5) Call the service **through Primordia’s proxy** (agent way)

> Agents **must use this** so they don’t need to know host ports or container DNS.

```bash
curl -sS -X POST http://localhost:8080/workspace/proxy \
  -H 'content-type: application/json' \
  -d '{"url":"http://primordia-local-service-hot-swap-final:8080/hello","method":"GET"}'
```

Expected (wrapped by proxy): `{ "ok": true, "status": 200, "body": { "value": "{\"ok\":true,...}" } }`

**Notes**

* The proxy checks `PROXY_ALLOWLIST` (literal match). If you get `Origin not allowed`, add the exact origin to that env and restart only `primordia`.
* Inside containers, always use service DNS names (e.g., `primordia-local-service-<name>`) — never `localhost`.

---

## 6) Hot-swap handler (no redeploy)

> Because index dynamically imports on every request, updating `handler.js` takes effect immediately.

```bash
curl -sS -X POST http://localhost:8080/file \
  -H 'content-type: application/json' \
  -d @- <<'JSON'
{
  "path": "runs/hot-swap-final/handler.js",
  "content": "export default (req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,message:'v2 LIVE swap',t:new Date().toISOString()}));};"
}
JSON

# Verify via proxy (preferred)
curl -sS -X POST http://localhost:8080/workspace/proxy \
  -H 'content-type: application/json' \
  -d '{"url":"http://primordia-local-service-hot-swap-final:8080/hello","method":"GET"}'
```

Expected: response with `"message":"v2 LIVE swap"`.

---

## 7) Troubleshooting (one change → one check)

**Symptom → Fix**

* **Launcher log:** `ALREADY_EXISTS: Subscription already exists`
  ➜ Use a **unique** `LOCAL_LAUNCHER_SUB` (e.g., `...-2`) and restart only `local-launcher`.

* **Launcher log:** `No public port '8080/tcp' published`
  ➜ Ensure the launcher’s `docker run` includes **`-p 0:8080`**.

* **Proxy returns `Origin not allowed`**
  ➜ Add exact origin to `PROXY_ALLOWLIST` (comma-separated), restart only `primordia`.

* **`gcloud` inside containers asks for login**
  ➜ Use emulator **REST** endpoints instead of `gcloud` for list/publish/pull.

* **Primordia can’t reach service by name**
  ➜ Verify both are on `primordia_default` network:
  `docker exec primordia-primordia-1 getent hosts primordia-local-service-<name>`

---

## 8) Minimal agent contract (what agents should/shouldn’t do)

**Agents SHOULD:**

* Write service files via `POST /file` to `runs/<run-name>/...`
* Publish deploy event to emulator `primordia-builds`.
* Call service **through** Primordia: `POST /workspace/proxy { url, method, (optional) body, headers }`.
* Log each action and **verify**:

  * `/healthz` → ok
  * `/workspace/proxy` → status 200
  * `/hello` via proxy → expected JSON

**Agents SHOULD NOT:**

* Assume a fixed host port. Always use the proxy.
* Use `localhost` from inside containers (use service DNS).
* Modify Docker/compose files on their own (humans keep infra stable).

---

## 9) Copy-paste verification bundle (end-to-end)

```bash
# Health
curl -sS http://localhost:8080/healthz

# Seed files
# (use step 3 blocks)

# Deploy
RUN_NAME=hot-swap-final
MSG=$(printf '{"type":"SERVICE_DEPLOYED","name":"%s"}' "$RUN_NAME" | base64 -w0)
curl -s -H "Content-Type: application/json" -d "{\"messages\":[{\"data\":\"$MSG\"}]}" \
  http://localhost:8083/v1/projects/ticktalk-472521/topics/primordia-builds:publish

# Proxy call (preferred)
curl -sS -X POST http://localhost:8080/workspace/proxy \
  -H 'content-type: application/json' \
  -d '{"url":"http://primordia-local-service-hot-swap-final:8080/hello","method":"GET"}'
```
