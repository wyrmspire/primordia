nice 😄 want me to fill `localtroubles.md` with a clean, copy-pasteable guide? here’s a ready-to-drop version.

---

# Local Troubleshooting — Primordia

This doc captures what we learned getting the **local emulators** + **Primordia** working reliably.

## What “working” looks like

* Containers up: `primordia`, `pubsub`, `gcs`, `local-launcher`, and a **standalone** `primordia-firestore` container.
* All on the same network: `primordia_default`.
* Inside `primordia`, env contains:

  * `PROJECT_ID=ticktalk-472521`
  * `FIRESTORE_EMULATOR_HOST=firestore:8085`
  * `STORAGE_EMULATOR_HOST=http://gcs:4443`
  * `PUBSUB_EMULATOR_HOST=pubsub:8083`
  * `WORKSPACE_BUCKET=primordia-bucket`
  * `PUBSUB_TOPIC=primordia-builds`
  * `DEPLOY_TARGET=local`, `FORCE_LOCAL=1` (optional but helpful)

---

## Golden path (from a clean shell)

> Run these from `~/primordia`.

```bash
# 1) Start core services (skip firestore here)
docker compose up -d gcs pubsub primordia local-launcher

# 2) Ensure no stray 8085 binder
docker rm -f primordia-firestore 2>/dev/null || true
docker ps --format '{{.ID}}\t{{.Names}}\t{{.Ports}}' | grep 8085 || echo "no 8085 binder"

# 3) Start Firestore emulator (standalone) with Java 21, on same network + alias
docker run -d --name primordia-firestore \
  --network primordia_default \
  --network-alias firestore \
  -p 8085:8085 \
  gcr.io/google.com/cloudsdktool/cloud-sdk:latest \
  bash -lc 'set -e; apt-get update -qq; \
    apt-get install -y -qq wget gnupg ca-certificates >/dev/null; \
    install -d -m 0755 /etc/apt/keyrings; \
    wget -qO- https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor -o /etc/apt/keyrings/adoptium.gpg; \
    . /etc/os-release; \
    echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb ${VERSION_CODENAME} main" > /etc/apt/sources.list.d/adoptium.list; \
    apt-get update -qq; \
    apt-get install -y -qq temurin-21-jre google-cloud-cli-firestore-emulator >/dev/null; \
    exec gcloud beta emulators firestore start --host-port=0.0.0.0:8085 --project=ticktalk-472521'
```

---

## Sanity checks

```bash
# network membership
docker network inspect primordia_default --format '{{range .Containers}}{{.Name}} {{end}}'

# inside primordia: TCP + HTTP to firestore (use bash so /dev/tcp works)
docker compose exec primordia bash -lc '(echo >/dev/tcp/firestore/8085) 2>/dev/null && echo TCP_OK || echo TCP_FAIL'
docker compose exec primordia bash -lc 'apt-get update -qq >/dev/null 2>&1 || true; apt-get install -y -qq curl >/dev/null 2>&1 || true; curl -sv http://firestore:8085/ 2>&1 | head -n 5'

# firestore write smoke test
docker compose exec -e FIRESTORE_EMULATOR_HOST=firestore:8085 primordia \
  node -e "const {Firestore}=require('@google-cloud/firestore'); const db=new Firestore({projectId:'ticktalk-472521'}); db.collection('primordia_tasks').doc('ping').set({ok:true,ts:Date.now()}).then(()=>console.log('FIRESTORE_WRITE_OK')).catch(e=>{console.error('FIRESTORE_WRITE_ERR:',e.message);process.exit(1)});"

# gcs list (host)
curl -sS 'http://localhost:4443/storage/v1/b?project=ticktalk-472521' | jq

# gcs write smoke (inside primordia)
docker compose exec -e STORAGE_EMULATOR_HOST=http://gcs:4443 primordia \
  node -e "
    const {Storage}=require('@google-cloud/storage');
    (async()=>{
      const s=new Storage({projectId:'ticktalk-472521'});
      const b=s.bucket(process.env.WORKSPACE_BUCKET||'primordia-bucket');
      const f=b.file('smoke/test.txt');
      await f.save('hello-from-primordia');
      const [buf]=await f.download();
      console.log('STORAGE_OK:', buf.toString());
    })().catch(e=>{console.error('STORAGE_ERR:',e.message); process.exit(1)});"

# healthz (host)
curl -fsS http://localhost:8080/healthz
```

> Submitting jobs:

```bash
curl -sS -X POST "http://localhost:8080/workspace" \
  -H "content-type: application/json" \
  -d '{"type":"deploy-run-service","name":"hot-swap-final"}' | tee _job_local.json
jq -r '.jobId // empty' _job_local.json
```

*Note:* `deploy-run-service` may log `Not Found` locally (it targets Cloud Run). That’s expected unless you connect real GCP resources. The key is: the API responds, jobs enqueue, logs tick.

---

## Known gotchas & fixes

### 1) Firestore emulator needs Java 21

* **Symptom:** `ERROR: The java executable on your PATH is not a Java 21+ JRE`
* **Fix:** Don’t use the Compose `firestore` image until it’s fixed. Use the standalone `cloud-sdk` container above which installs Temurin 21.

### 2) “Bind for 0.0.0.0:8085 failed: port is already allocated”

* **Cause:** A stray container already mapped 8085 on the host.
* **Fix:**

  ```bash
  docker ps --format '{{.ID}}\t{{.Names}}\t{{.Ports}}' | grep 8085
  docker rm -f primordia-firestore
  ```

### 3) TCP test fails but service is up

* **Cause:** Using `sh` shell (no `/dev/tcp`).
* **Fix:** Run tests via `bash -lc '...'` or use `curl`.

### 4) Name resolution errors inside Primordia

* **Symptom:** `Name resolution failed for target dns:firestore:8085`
* **Fixes:**

  * Ensure the standalone Firestore is on `--network primordia_default --network-alias firestore`.
  * In `primordia`: `getent hosts firestore` should return an IP on the bridge.
  * Don’t rely on the Compose `firestore` service if it’s failing Java.

### 5) GCS emulator ECONNREFUSED to `0.0.0.0:4443`

* **Cause:** Using host binding from inside a container.
* **Fix:** Inside containers use `http://gcs:4443`. From the host use `http://localhost:4443`.

### 6) Pub/Sub `gcloud` lacks project

* **Symptom:** `The required property [project] is not currently set.`
* **Fix:** Pass it per command:

  ```bash
  docker compose exec -e CLOUDSDK_CORE_PROJECT=ticktalk-472521 pubsub gcloud pubsub topics list
  ```

### 7) Jobs “freeze” / stay `PENDING`

* **Usually:** They’re enqueued but waiting on a remote call or an emulator isn’t reachable.
* **Check:**

  * Tail `docker compose logs -f primordia`.
  * Verify emulator reachability (TCP + curl tests above).
  * If you don’t want Cloud Run at all, stick to local-only flows.

---

## Tips

* Inside containers, **never** call other services via `localhost`; use service DNS names (`firestore`, `gcs`, `pubsub`).
* If the terminal “freezes,” open another terminal and tail logs to see what it’s doing.
* Add a tiny `docker-compose.override.yml` to make intent explicit:

  ```yaml
  services:
    primordia:
      environment:
        DEPLOY_TARGET: local
        FORCE_LOCAL: "1"
        LOCAL_EVENTS_TOPIC: primordia-local-events
  ```

---

want me to PR this into the repo (or tweak the tone/sections)?
