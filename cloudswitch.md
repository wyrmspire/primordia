

# Primordia: Local-First Mode vs Cloud Deploys

This document captures the changes we made to run Primordia **entirely on your laptop** with local emulators, what’s different from a cloud deployment, and how to flip back when you’re ready to ship to GCP.

## 1) Why we did this

* We wanted end-to-end development **without** GCP credentials, network access, or real Cloud Run/Firestore/GCS resources.
* We added a **local launcher** that can spin up service containers on your machine and a **repeatable emulator stack** (Pub/Sub, Firestore, GCS) that everything talks to.

## 2) What’s running locally

All containers share the same Docker network (`primordia_default`):

* **primordia** – API/worker/bridge (port 8080 to host)
* **pubsub** – Pub/Sub emulator (in-network: `pubsub:8083`)
* **gcs** – GCS emulator via **HTTP** (in-network: `http://gcs:4443`, host: `http://localhost:4443`)
* **firestore** – Firestore emulator (we used a Java-21 image when the stock one lacked it) (in-network: `firestore:8085`)
* **local-launcher** – listens on Pub/Sub and starts per-service Docker containers on your machine for local “run service” events

## 3) Key environment variables (local)

Inside containers (not on host):

```
PROJECT_ID=ticktalk-472521
GOOGLE_CLOUD_PROJECT=ticktalk-472521
GCLOUD_PROJECT=ticktalk-472521

PUBSUB_EMULATOR_HOST=pubsub:8083
FIRESTORE_EMULATOR_HOST=firestore:8085
STORAGE_EMULATOR_HOST=http://gcs:4443

WORKSPACE_BUCKET=primordia-bucket
DEPLOY_TARGET=local
FORCE_LOCAL=1
ALLOW_LOCAL_PROXY=1
```

> **Note:** Inside Docker, always use service DNS names (`pubsub`, `firestore`, `gcs`). From your host, use `localhost`.

## 4) GCS emulator: HTTP-only

We forced the fake GCS server to run **HTTP** on 4443 to avoid TLS handshake failures:

```yaml
# docker-compose.override.yml (gcs section)
services:
  gcs:
    entrypoint: ["/bin/fake-gcs-server"]
    command: ["-scheme","http","-port","4443","-external-url","http://gcs:4443"]
```

Result:

* From containers: `STORAGE_EMULATOR_HOST=http://gcs:4443`
* From host: `curl http://localhost:4443/storage/v1/b`

## 5) Firestore emulator: Java 21

We hit “Java 21+ required” in one image. We solved it by running a known-good image that **installs Java 21** and the emulator, then exposes `firestore:8085`. If your Compose image already has Java 21, you don’t need this workaround.

## 6) Pub/Sub topics & subscriptions (local)

What we stabilized on:

* Topic Primordia publishes to for internal events: **`primordia-builds`**
* Worker sub: **`primordia-worker-sub`**
* Local launcher sub: **`primordia-local-launcher-sub`** (we sometimes used a `-2` suffix to avoid conflicts during debugging)

You can inspect the emulator state without `gcloud` auth using REST:

```bash
# List subs
curl -s http://localhost:8083/v1/projects/ticktalk-472521/subscriptions | jq
# Publish a message to a topic
MSG=$(printf '{"type":"SERVICE_DEPLOYED","name":"hot-swap-final"}' | base64 -w0)
curl -s -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"data\":\"$MSG\"}]}" \
  http://localhost:8083/v1/projects/ticktalk-472521/topics/primordia-builds:publish | jq
```

## 7) Local launcher: what it does differently

* **Listens** on Pub/Sub (emulator) for events (e.g., `SERVICE_DEPLOYED`).
* **Spawns** a Docker container per service name using the local Docker daemon.
* **Downloads service code** (`index.js`, `package.json`, `handler.js`) from the **workspace bucket** on the GCS emulator.
* **Runs the service** on container port `8080` and publishes a **host port** automatically.

### Important fixes we made

1. **Port publishing**
   We added `-p 0:8080` to the launcher’s `docker run` so a random host port is mapped to the service’s `8080`.
   Otherwise, `docker port … 8080/tcp` returns “No public port published”.

2. **HTTP downloads instead of SDK**
   We switched the child startup script to fetch files from fake-GCS using **HTTP** (`curl`), avoiding early `npm install`/SDK dependencies.

3. **Project envs for the Pub/Sub client**
   We ensured `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT` are set (some libs prefer them over `PROJECT_ID`).

## 8) How “hot-swap” worked locally

* Service code lives in the workspace bucket: `runs/<service-name>/{index.js,package.json,handler.js}`.
* The local service (Node 18/20) dynamically imports `handler.js` so you can live-swap it by overwriting the file through the Primordia `/file` API.
* Calling `/hello` hits the current handler; a subsequent `/file` update takes effect immediately (no container restart).

## 9) Quick local smoke tests

* **Primordia health:** `curl -fsS http://localhost:8080/healthz`
* **GCS:** `curl -s http://localhost:4443/storage/v1/b?project=ticktalk-472521`
* **Firestore TCP (inside primordia):**

  ```
  docker compose exec primordia bash -lc '(echo >/dev/tcp/firestore/8085) && echo OK || echo FAIL'
  ```
* **Publish an event:** use the REST snippet in §6 and watch `local-launcher` logs.
* **Find service port:** `docker ps | grep primordia-local-service-<name>` → hit `http://localhost:<port>/hello`

## 10) Differences from a cloud deploy

| Area      | Local mode                              | Cloud mode                        |
| --------- | --------------------------------------- | --------------------------------- |
| Auth      | None                                    | GCP credentials required          |
| Firestore | Emulator (`firestore:8085`)             | Real Firestore                    |
| Storage   | fake-GCS HTTP (`gcs:4443`)              | GCS buckets                       |
| Pub/Sub   | Emulator (`pubsub:8083`)                | Real Pub/Sub                      |
| Services  | Launched via local Docker (`-p 0:8080`) | Cloud Run or your managed runtime |
| Endpoints | `localhost` ports                       | Cloud Run URLs (HTTPS)            |
| Network   | Single Docker network                   | GCP networking                    |

## 11) Switching back to cloud

When you’re ready to deploy to GCP:

1. **Unset emulator envs** (or switch to cloud profiles):

   * Remove/override `PUBSUB_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST`.
2. **Point storage to real GCS** and use a real bucket (e.g., `gs://your-bucket`).
3. **Ensure project & creds**:

   * `GOOGLE_CLOUD_PROJECT=<your-project>`
   * Application Default Credentials (ADC) or a service account key mounted as secret.
4. **Use real deploy blueprints**:

   * If your job types include `deploy-run-service` → ensure it addresses **Cloud Run** (image names, region, service name).
5. **Topics/subscriptions**:

   * Create them in GCP (`gcloud`), update IAM for any service accounts that publish/subscribe.

### Cloud deploy checklist

* [ ] `gcloud auth application-default login` (or mount a service account JSON)
* [ ] Enable APIs (Cloud Run, Artifact Registry, Pub/Sub, Firestore, Storage)
* [ ] Replace emulator envs with cloud config
* [ ] Push images to Artifact Registry (if using containers)
* [ ] Create Pub/Sub topics/subscriptions in the project
* [ ] Deploy service(s) to Cloud Run; note their HTTPS URLs
* [ ] Update Primordia config to call Cloud Run endpoints instead of `localhost`

## 12) Known local gotchas (and resolutions)

* **fake-GCS defaulted to HTTPS** → forced **HTTP** (`-scheme http`) to fix “Client sent HTTP to HTTPS server” and self-signed cert errors.
* **Firestore emulator needing Java 21** → used an image that installs Temurin 21 and `google-cloud-cli-firestore-emulator`.
* **Local launcher not consuming events** → set `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT` and verified subscription exists in the emulator.
* **Launcher couldn’t find a port** → added `-p 0:8080` to its `docker run`.
* **Container DNS vs localhost** → inside Docker use `gcs:4443`, `firestore:8085`, `pubsub:8083`; from host use `localhost`.

## 13) Minimal local bring-up (happy path)

```bash
# from repo root
docker compose up -d

# verify
curl -fsS http://localhost:8080/healthz

# (optional) publish a local deploy event to start a service container
MSG=$(printf '{"type":"SERVICE_DEPLOYED","name":"hot-swap-final"}' | base64 -w0)
curl -s -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"data\":\"$MSG\"}]}" \
  http://localhost:8083/v1/projects/ticktalk-472521/topics/primordia-builds:publish
```

---

If you want, I can turn this into a `docs/local-first.md` file with a tiny “Quick Start (No GCP)” sidebar and a “Switch to Cloud” sidebar.
