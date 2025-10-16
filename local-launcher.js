import { PubSub } from "@google-cloud/pubsub";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";

// ---- env ----
const TOPIC            = process.env.LOCAL_EVENTS_TOPIC     || "primordia-builds";
const SUB              = process.env.LOCAL_LAUNCHER_SUB     || "primordia-local-launcher-sub";
const PROJECT_ID       = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.PROJECT_ID || "ticktalk-472521";
const PUBSUB_EMULATOR  = process.env.PUBSUB_EMULATOR_HOST   || "pubsub:8083";
const NETWORK          = process.env.DOCKER_NETWORK         || "primordia_default";
const WORKSPACE_BUCKET = process.env.WORKSPACE_BUCKET       || "primordia-bucket";
const STORAGE          = process.env.STORAGE_EMULATOR_HOST  || "http://gcs:4443";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr || r.stdout || ""}`);
  return (r.stdout || "").trim();
}

function startService(name) {
  const container = `primordia-local-service-${name}`;
  // cleanup any old container
  spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });

  // run a tiny bootstrap hosted in fake-GCS (installs curl, pulls files, runs node index.js)
  const bootstrapURL = `${STORAGE.replace(/\/$/,'')}/storage/v1/b/${WORKSPACE_BUCKET}/o/runs%2F_bootstrap%2Fservice-bootstrap.sh?alt=media`;
  const args = [
    "run","-d",
    "--name", container,
    "--network", NETWORK,
    "-e", `WORKSPACE_BUCKET=${WORKSPACE_BUCKET}`,
    "-e", `STORAGE_EMULATOR_HOST=${STORAGE}`,
    "-e", `SVC_NAME=${name}`,
    "-e", `GCLOUD_PROJECT=${PROJECT_ID}`,
    "-e", `GOOGLE_CLOUD_PROJECT=${PROJECT_ID}`,
    "-p","0:8080",
    "node:20-slim",
    "sh","-lc",
    `set -e; apt-get update -qq >/dev/null || true; apt-get install -y -qq ca-certificates curl >/dev/null 2>&1 || true; curl -sSf "${bootstrapURL}" | sh`
  ];
  const r = spawnSync("docker", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`docker run failed:\n${r.stderr || r.stdout || ""}`);

  // robust port discovery (nil-safe)
  let hostPort = "";
  for (let i = 0; i < 40; i++) {
    try {
      hostPort = run("docker", ["inspect","--format","{{with (index (index .NetworkSettings.Ports \"8080/tcp\") 0)}}{{.HostPort}}{{end}}", container]).replace(/\r/g,"");
      if (!hostPort) {
        const line = run("docker", ["port", container, "8080/tcp"]).split("\n").shift() || "";
        hostPort = (line.split(":").pop() || "").trim();
      }
      if (hostPort) break;
    } catch {}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  if (!hostPort) throw new Error("service started but no published port found");
  console.log(`[launcher] STARTED ${name} on http://localhost:${hostPort} (container :8080)`);
}

async function main() {
  process.env.PUBSUB_EMULATOR_HOST = PUBSUB_EMULATOR;
  const pubsub = new PubSub({ projectId: PROJECT_ID });

  try { await pubsub.topic(TOPIC).get({ autoCreate: true }); } catch {}
  try { await pubsub.subscription(SUB).get({ autoCreate: true, topic: TOPIC }); } catch {}

  const sub = pubsub.subscription(SUB);
  console.log(`[launcher] listening on ${TOPIC} (${SUB}) via ${PUBSUB_EMULATOR}...`);

  sub.on("message", (msg) => {
    try {
      const raw = Buffer.from(msg.data||"").toString("utf8"); if(!raw.trim()){ msg.ack?.(); return; }
      const data = raw ? JSON.parse(raw) : {};
      const type = data.type || data.event || "";
      const name = data.name || data.service || data.run || "";

      if (!name) throw new Error("missing service name");
      if (["SERVICE_DEPLOYED","DEPLOY_RUN_SERVICE","deploy-run-service"].includes(type)) {
        // if already up, do nothing
        const existing = spawnSync("docker", ["ps","-q","-f",`name=^/primordia-local-service-${name}$`], {encoding:"utf8"}).stdout.trim();
        if (existing) { console.log(`[launcher] ${name} already running; ignoring`); }
        else { console.log(`[launcher] deploy for '${name}'...`); startService(name); }
      } else {
        console.log("[launcher] ignoring message type:", type || "(none)");
      }
    } catch (e) {
      console.error("[launcher] bad message:", (e && e.message) || e);
    } finally { try { msg.ack(); } catch {} }
  });

  sub.on("error", (e) => {
    console.error("[launcher] subscriber error:", (e && e.message) || e);
    process.exit(1);
  });
}

main().catch((e) => {
  console.error("[launcher] fatal:", (e && e.message) || e);
  process.exit(1);
});
