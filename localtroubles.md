awesome — here’s a fresh, single-file doc you can drop into your repo. It rolls in everything we learned about the Firestore emulator (Java 21), GCS HTTPS vs HTTP, Pub/Sub, the local-launcher needing a Docker CLI, and the manual “run service locally” workaround.

If you want to save it exactly:

````bash
cat > HOWTO-local.md <<'MDOC'
# Primordia Local Stack (Firestore + Pub/Sub + GCS + Local Service)

This is the **current working recipe** for running Primordia end-to-end on a single machine using Docker, with emulators for Firestore, Pub/Sub, and GCS, and a way to run a local service for quick iteration.

It includes:
- What “working” looks like
- Exact bring-up commands
- Quick checks
- How to run a service locally (no Cloud Run)
- Troubleshooting (all the gotchas we hit)
- Why the local-launcher needed Docker and what we’re doing instead

---

## TL;DR (Golden Path)

```bash
# from repo root (~/primordia)
./startl   # or: docker compose up -d gcs pubsub primordia local-launcher

# ensure GCS emulator is HTTP (not HTTPS)
docker compose logs --tail=1 gcs

# Firestore emulator: run as a standalone container with Java 21 and alias "firestore"
docker rm -f primordia-firestore 2>/dev/null || true
docker run -d --name primordia-firestore \
  --network primordia_default \
  --network-alias firestore \
  -p 8085:8085 gcr.io/google.com/cloudsdktool/cloud-sdk:latest \
  bash -lc 'set -e; apt-get update -qq; \
    apt-get install -y -qq wget gnupg ca-certificates >/dev/null; \
    install -d -m 0755 /etc/apt/keyrings; \
    wget -qO- https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor -o /etc/apt/keyrings/adoptium.gpg; \
    . /etc/os-release; \
    echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb ${VERSION_CODENAME} main" > /etc/apt/sources.list.d/adoptium.list; \
    apt-get update -qq; \
    apt-get install -y -qq temurin-21-jre google-cloud-cli-firestore-emulator >/dev/null; \
    exec gcloud beta emulators firestore start --host-port=0.0.0.0:8085 --project=ticktalk-472521'

# verify from inside the primordia container
docker compose exec primordia bash -lc '
  echo "DNS:"; getent hosts firestore gcs pubsub;
  (echo >/dev/tcp/firestore/8085) 2>/dev/null && echo "FS TCP_OK" || echo "FS TCP_FAIL";
  apt-get update -qq >/dev/null 2>&1 || true; apt-get install -y -qq curl >/dev/null 2>&1 || true;
  echo; echo "[FS curl]"; curl -sS -m3 http://firestore:8085/ | head -c 100 || true
'

# Firestore write smoke test (SDK uses FIRESTORE_EMULATOR_HOST)
docker compose exec -e FIRESTORE_EMULATOR_HOST=firestore:8085 primordia \
  node -e "const {Firestore}=require('@google-cloud/firestore'); \
    (async()=>{const db=new Firestore({projectId:'ticktalk-472521'}); \
    const id='chk_'+Date.now(); await db.collection('primordia_emulator_smoke').doc(id).set({ok:true}); \
    const got=await db.collection('primordia_emulator_smoke').doc(id).get(); \
    console.log('FIRESTORE_OK', got.exists);})().catch(e=>{console.error(e);process.exit(2)})"

# GCS is HTTP (inside containers use http://gcs:4443)
docker compose exec primordia sh -lc '
  echo "[GCS http probe]"; curl -sS -m3 http://gcs:4443/storage/v1/b | head -c 60 || true
'

# primordia health
curl -fsS http://localhost:8080/healthz && echo

# (Optional) run your service locally (no Cloud Run), see section below
````

---

## What “working” looks like

* Containers up: `primordia`, `pubsub`, `gcs`, `local-launcher` **plus** a standalone `primordia-firestore`.
* All on the **same** Docker network: `primordia_default`.
* From inside containers:

  * **Firestore** at `firestore:8085`
  * **Pub/Sub** at `pubsub:8083`
  * **GCS** at `http://gcs:4443` (HTTP, not HTTPS)
* Primordia envs (inside `primordia`):

  * `PROJECT_ID`, `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` all `ticktalk-472521`
  * `FIRESTORE_EMULATOR_HOST=firestore:8085`
  * `PUBSUB_EMULATOR_HOST=pubsub:8083`
  * `STORAGE_EMULATOR_HOST=http://gcs:4443`
  * `WORKSPACE_BUCKET=primordia-bucket`
  * `DEPLOY_TARGET=local`, `FORCE_LOCAL=1`

---

## Why we run Firestore emulator outside Compose

The Compose Firestore image we had **requires Java 21** but didn’t ship with it, so it refused to start:

> `ERROR ... The Java executable on your PATH is not a Java 21+ JRE`

We solved this by launching a **standalone** `cloud-sdk` container, installing **Temurin 21 JRE** plus the `google-cloud-cli-firestore-emulator`, and starting the emulator on `0.0.0.0:8085`. We give it the **network alias `firestore`** so all other containers resolve `firestore:8085`.

---

## GCS emulator must be HTTP

The fake-GCS image defaults to TLS. That broke calls (we saw:
“Client sent an HTTP request to an HTTPS server” and “self-signed cert”).
We force **HTTP** with a Compose override:

```yaml
services:
  gcs:
    entrypoint: ["/bin/fake-gcs-server"]
    command: ["-scheme","http","-port","4443","-external-url","http://gcs:4443"]
```

Then **inside containers** you MUST use `http://gcs:4443` (not https).

Quick probe from `primordia`:

```bash
docker compose exec primordia sh -lc '
  echo "[HTTP]";  (curl -sS -m3 http://gcs:4443/storage/v1/b | head -c 120 || true); echo;
  echo "[HTTPS]"; (curl -sS -m3 https://gcs:4443/storage/v1/b | head -c 120 || true); echo
'
# Expect JSON on HTTP, and failure on HTTPS (by design)
```

---

## Pub/Sub emulator

Lives at `pubsub:8083`. Primordia publishes periodic health checks, and the worker consumes jobs. We verified topics/subs from the `pubsub` container with a project set:

```bash
docker compose exec -e CLOUDSDK_CORE_PROJECT=ticktalk-472521 pubsub \
  gcloud pubsub topics list --format="value(name)"
```

---

## Local-launcher & Docker CLI (what happened + current plan)

**Why it needed Docker:** The launcher’s job is to receive “deploy-run-service” events and **start a new container** that serves your code (maps a random host port to `8080` inside). To `docker run` that child container, the launcher container needs:

* the **Docker CLI** installed,
* and the host’s Docker socket mounted: `-v /var/run/docker.sock:/var/run/docker.sock`.

**What we hit:**

* Our first attempts to install the Docker CLI dynamically in `node:20-slim` were brittle (APT repo lines, `${CODENAME}`, and `/bin/sh` not supporting `set -o pipefail`).
* Result: launcher either died at boot or never got a working `docker` binary, so it printed “bad message … (no output)” and nothing ran.

**Current plan that works now:**
Until we make the launcher image ship with the CLI preinstalled, **bypass the launcher** and run the service manually (next section). This is simple, reliable, and uses the same emulators/network.

---

## Running a service locally (manual, reliable)

This replicates what the launcher would do: pull your `index.js` / `handler.js` from the workspace bucket and start a `node` server.

```bash
# 0) stop any old one
docker rm -f primordia-local-service-hot-swap-final 2>/dev/null || true

# 1) start on the primordia network (so it can reach gcs/firestore/pubsub by name)
docker run -d --rm --name primordia-local-service-hot-swap-final \
  --network primordia_default \
  -e STORAGE_EMULATOR_HOST=http://gcs:4443 \
  -e WORKSPACE_BUCKET=primordia-bucket \
  -p 0:8080 node:20-slim sh -lc '
    set -e
    apt-get update -qq && apt-get install -y -qq curl >/dev/null
    mkdir -p /app && cd /app
    curl -fsS -o package.json "http://gcs:4443/storage/v1/b/primordia-bucket/o/runs%2Fhot-swap-final%2Fpackage.json?alt=media"
    curl -fsS -o index.js     "http://gcs:4443/storage/v1/b/primordia-bucket/o/runs%2Fhot-swap-final%2Findex.js?alt=media"
    curl -fsS -o handler.js   "http://gcs:4443/storage/v1/b/primordia-bucket/o/runs%2Fhot-swap-final%2Fhandler.js?alt=media"
    exec node /app/index.js
  '

# 2) discover mapped port and test
PORT=$(
  docker ps --format '{{.Ports}}' \
  | tr ',' '\n' | sed -n 's/.*0\.0\.0\.0:\([0-9]\+\)->8080\/tcp.*/\1/p' \
  | tail -1
)
SERVICE_URL=${PORT:+http://localhost:$PORT}
echo "SERVICE_URL=$SERVICE_URL"
curl -i "$SERVICE_URL/hello"
```

Notes:

* If you see plain `Not Found` with a `404`, your `index.js` didn’t route `/hello` or `handler.js` didn’t load—re-check that the three files exist in `runs/hot-swap-final/` in the bucket (you can list them via the Primordia API: `GET /files?prefix=runs/hot-swap-final/`).
* The “live swap” will reflect as soon as you POST a new `handler.js` to the workspace and your `index.js` re-imports it per request (our example defeats module cache with a querystring timestamp).

---

## Quick verification checklist

Inside `primordia`:

```bash
env | egrep -i "FIRESTORE|PUBSUB|STORAGE|PROJECT|BUCKET" | sort
getent hosts firestore pubsub gcs
curl -sS -m3 http://firestore:8085/ | head -c 80 || true
curl -sS -m3 http://gcs:4443/storage/v1/b | head -c 80 || true
```

From host:

```bash
curl -fsS http://localhost:8080/healthz
```

---

## Troubleshooting (the ones we actually hit)

**Firestore “Java 21” error**

* *Symptom:* `The Java executable on your PATH is not a Java 21+ JRE`
* *Fix:* Use the standalone `cloud-sdk` container + install `temurin-21-jre` before starting emulator.

**DNS can’t resolve `firestore` from `primordia`**

* *Cause:* Firestore not on the same network or no alias.
* *Fix:* Run the emulator with `--network primordia_default --network-alias firestore`. Check with `getent hosts firestore`.

**GCS TLS handshake / self-signed errors**

* *Cause:* fake-GCS defaulted to HTTPS; clients were using HTTP.
* *Fix:* Force **HTTP** in Compose (`-scheme http`), use `http://gcs:4443` inside containers.

**Jobs stuck `PENDING` / “Client sent HTTP to HTTPS server”**

* *Cause:* Mixed protocols when proxying to the local service.
* *Fix:* Standardize on HTTP for fake-GCS; ensure service URL is `http://localhost:<port>`.

**local-launcher prints “bad message … (no output)”**

* *Cause:* No Docker CLI inside the launcher, or its entrypoint shell died on `set -o pipefail`.
* *Fix:* Either ship an image with Docker CLI preinstalled or (current approach) **bypass** and start the service manually (above).

**`/dev/tcp/host/port` probe fails**

* *Cause:* Using `sh` instead of `bash`.
* *Fix:* `docker compose exec <svc> bash -lc '(echo >/dev/tcp/host/port)'` or just use `curl`.

---

## Appendix: Minimal `docker-compose.override.yml`

This is what we’re actually relying on right now (note: no Firestore service here; we run that as a standalone container with Java 21):

```yaml
services:
  primordia:
    environment:
      - DEPLOY_TARGET=local
      - FORCE_LOCAL=1
      - WORKSPACE_BUCKET=primordia-bucket
      - PUBSUB_EMULATOR_HOST=pubsub:8083
      - FIRESTORE_EMULATOR_HOST=firestore:8085
      - STORAGE_EMULATOR_HOST=http://gcs:4443
      - PROJECT_ID=ticktalk-472521
      - GCLOUD_PROJECT=ticktalk-472521
      - GOOGLE_CLOUD_PROJECT=ticktalk-472521
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock

  # force fake-gcs to HTTP (4443)
  gcs:
    entrypoint: ["/bin/fake-gcs-server"]
    command: ["-scheme","http","-port","4443","-external-url","http://gcs:4443"]

  # the local-launcher is presently optional while we run services manually
  local-launcher:
    image: node:20-slim
    working_dir: /app
    volumes:
      - .:/app:ro
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WORKSPACE_BUCKET=primordia-bucket
      - PUBSUB_EMULATOR_HOST=pubsub:8083
      - FIRESTORE_EMULATOR_HOST=firestore:8085
      - STORAGE_EMULATOR_HOST=http://gcs:4443
      - PROJECT_ID=ticktalk-472521
      - GCLOUD_PROJECT=ticktalk-472521
      - GOOGLE_CLOUD_PROJECT=ticktalk-472521
    command: ["node","/app/src/worker/local-launcher.js"]
```

> If/when we want the launcher to spin up containers automatically again, we’ll swap its image to one that **already includes** the Docker CLI, or bake the install into a custom image so we’re not fighting APT inside `node:20-slim` at runtime.

---

That’s it. With this setup, Firestore/GCS/PubSub work, Primordia’s API/worker are healthy, and you can run the target service locally (hot-swap handler by POSTing a new `handler.js` into the workspace).

MDOC

```

If you want me to prune this further or turn it into a PR-ready `HOWTO-local.md`, say the word.
```
