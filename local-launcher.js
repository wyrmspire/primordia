import { PubSub } from "@google-cloud/pubsub";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";

// ---------- config ----------
const TOPIC            = process.env.LOCAL_EVENTS_TOPIC     || "primordia-builds";
const SUB              = process.env.LOCAL_LAUNCHER_SUB     || "primordia-local-launcher-sub";
const PROJECT_ID       = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.PROJECT_ID || "ticktalk-472521";
const PUBSUB_EMULATOR  = process.env.PUBSUB_EMULATOR_HOST   || "pubsub:8083";
const NETWORK          = process.env.DOCKER_NETWORK         || "primordia_default";
const WORKSPACE_BUCKET = process.env.WORKSPACE_BUCKET       || "primordia-bucket";
const STORAGE          = process.env.STORAGE_EMULATOR_HOST  || "http://gcs:4443";
const ALLOWED_TYPES = new Set(["SERVICE_DEPLOYED","DEPLOY_RUN_SERVICE","deploy-run-service"]);
const DROP_TYPES    = new Set(["HEALTH_CHECK","PING","PULSE","CHECK","LIVENESS","READINESS"]);
const HEALTH_PATH      = process.env.LAUNCHER_HEALTH_PATH   || "/hello";
const LOG_LEVEL        = (process.env.LAUNCHER_LOG_LEVEL || "debug").toLowerCase(); // debug|info|warn|error
const PUB_LOGS         = process.env.LAUNCHER_PUBSUB_LOGS === "1";

// ---------- tiny logger ----------
const LEVELS = { debug:10, info:20, warn:30, error:40 };
const MIN = LEVELS[LOG_LEVEL] ?? 20;
let logPubsub = null;

function jlog(level, msg, meta = {}) {
  if ((LEVELS[level] ?? 999) < MIN) return;
  const rec = { ts: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(rec));
  if (PUB_LOGS && logPubsub) {
    try {
      const data = Buffer.from(JSON.stringify(rec));
      logPubsub.topic("primordia-logs").publishMessage({ data }).catch(()=>{});
    } catch {}
  }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
  const out = (r.stdout || "").slice(0, 16_000);
  const err = (r.stderr || "").slice(0, 16_000);
  return { status: r.status ?? -1, out, err };
}

function trimCRLF(s) { return (s || "").replace(/[\r\n]+$/g, ""); }

// ---------- service bootstrap via hosted script ----------
function startService(name, corr) {
  const svc = name;
  const container = `primordia-local-service-${svc}`;
  const meta = { phase: "startService", svc, corr };

  // if already running, skip
  let r = run("docker", ["ps","-q","-f", `name=^/${container}$`]);
  if (trimCRLF(r.out)) {
    jlog("info", "service already running; ignoring", { ...meta });
    return;
  }

  // best-effort cleanup
  jlog("debug", "docker rm -f (best effort)", { ...meta });
  run("docker", ["rm","-f", container]);

  // docker run with hosted bootstrap
  const args = [
    "run","-d",
    "--name", container,
    "--network", NETWORK,
    "-e", `WORKSPACE_BUCKET=${WORKSPACE_BUCKET}`,
    "-e", `STORAGE_EMULATOR_HOST=${STORAGE}`,
    "-e", `SVC_NAME=${svc}`,
    "-e", `GCLOUD_PROJECT=${PROJECT_ID}`,
    "-e", `GOOGLE_CLOUD_PROJECT=${PROJECT_ID}`,
    "-p","0:8080",
    "node:20-slim",
    "sh","-lc",
    // verbose bootstrap with clear echoes for each step
    `set -eu
     echo "[bootstrap] begin svc=${svc}"
     export NODE_NO_WARNINGS=1
     apt-get update -qq >/dev/null 2>&1 || true
     apt-get install -y -qq ca-certificates curl >/dev/null 2>&1 || true
     mkdir -p /app && cd /app
     host="${STORAGE}"; b="${WORKSPACE_BUCKET}"; run="${svc}"
     fget(){ curl -sf "${STORAGE}/storage/v1/b/${WORKSPACE_BUCKET}/o/runs%2F${svc}%2F$1?alt=media" -o "$1"; }
     echo "[bootstrap] fetch package.json"; fget package.json || echo "{\\"name\\":\\"${svc}\\",\\"version\\":\\"1.0.0\\",\\"main\\":\\"index.js\\"}" > package.json
     echo "[bootstrap] fetch index.js";     fget index.js
     echo "[bootstrap] fetch handler.js";   fget handler.js || true
     echo "[bootstrap] launching node"
     exec node index.js`
  ];

  const t0 = Date.now();
  jlog("info", "docker run", { ...meta, args: args.slice(0,12) }); // avoid logging the huge inline script
  r = run("docker", args);
  if (r.status !== 0) {
    jlog("error", "docker run failed", { ...meta, status: r.status, stderr: r.err, stdout: r.out });
    throw new Error("docker run failed");
  }
  jlog("debug", "docker run ok", { ...meta, ms: Date.now()-t0 });

  // wait for port mapping
  let hostPort = "";
  const tWait = Date.now();
  for (let i=0;i<40;i++){
    let pr = run("docker", ["inspect","--format","{{with (index (index .NetworkSettings.Ports \"8080/tcp\") 0)}}{{.HostPort}}{{end}}", container]);
    hostPort = trimCRLF(pr.out);
    if (!hostPort) {
      pr = run("docker", ["port", container, "8080/tcp"]);
      if (pr.status === 0 && pr.out) {
        hostPort = trimCRLF(pr.out).split(/\r?\n/)[0].split(":").pop();
      }
    }
    if (hostPort) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
  }
  if (!hostPort) {
    const logs = run("docker", ["logs","--tail","200", container]);
    jlog("error", "no published port; container logs follow", { ...meta, logs: logs.out || logs.err || "(no logs)" });
    throw new Error("service started but no published port found");
  }
  jlog("info", "port mapped", { ...meta, port: hostPort, wait_ms: Date.now()-tWait });

  // optional health probe
  const tProbe = Date.now();
  const probe = run("docker", ["exec", container, "node","-e",
    `require('http').get('http://127.0.0.1:8080${HEALTH_PATH}',r=>{process.stdout.write(String(r.statusCode||0))}).on('error',()=>process.stdout.write('0'))`]);
  const sc = Number(trimCRLF(probe.out)||0);
  jlog(sc===200 ? "info":"warn", "health probe", { ...meta, status: sc, ms: Date.now()-tProbe, path: HEALTH_PATH });

  jlog("info", "service STARTED", { ...meta, url:`http://localhost:${hostPort}`, container });
}

// ---------- main ----------
async function main() {
  process.env.PUBSUB_EMULATOR_HOST = PUBSUB_EMULATOR;
  const pubsub = new PubSub({ projectId: PROJECT_ID });
  logPubsub = pubsub;

  // ensure topic/sub exist
  try { await pubsub.topic(TOPIC).get({ autoCreate: true }); } catch {}
  try { await pubsub.subscription(SUB).get({ autoCreate: true, topic: TOPIC }); } catch {}

  const sub = pubsub.subscription(SUB);
  jlog("info", "listening", { topic: TOPIC, sub: SUB, emulator: PUBSUB_EMULATOR });

  sub.on("message", (msg) => {
    const meta = { phase: "message" };
    try {
      const raw = Buffer.from(msg.data || "").toString("utf8");
      if (!raw.trim()) { jlog("debug","empty message ignored", meta); msg.ack?.(); return; }

      const data = JSON.parse(raw);
      const type = data.type || data.event || "";
      if (!ALLOWED_TYPES.has(type)) { try { msg.ack(); } catch {} return; }
      const name = data.name || data.service || data.run || "";
      const corr = data.correlationId || `${type||'deploy'}:${name||'unknown'}:${Date.now()}`;
      const m2 = { ...meta, type, svc:name, corr };

      jlog("debug","received", { ...m2, raw_len: raw.length });

      if (!name) { try { msg.ack(); } catch {} return; }
      const wanted = ["SERVICE_DEPLOYED","DEPLOY_RUN_SERVICE","deploy-run-service"];
      if (!wanted.includes(type)) { jlog("debug","ignoring msg type", { ...m2 }); msg.ack?.(); return; }

      // prevent relaunch loop if already up
      const up = trimCRLF(run("docker",["ps","-q","-f",`name=^/primordia-local-service-${name}$`]).out);
      if (up) { jlog("info","already running; ignoring", m2); msg.ack?.(); return; }

      jlog("info","deploy start", m2);
      startService(name, corr);
      jlog("info","deploy done", m2);
    } catch (e) {
      jlog("error","message processing error", { err: (e && e.message) || String(e) });
    } finally {
      try { msg.ack(); } catch {}
    }
  });

  sub.on("error", (e) => {
    jlog("error","subscriber error", { err: (e && e.message) || String(e) });
    process.exit(1);
  });
}

main().catch((e)=>{
  jlog("error","fatal", { err: (e && e.message) || String(e) });
  process.exit(1);
});
