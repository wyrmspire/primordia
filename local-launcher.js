import { PubSub } from "@google-cloud/pubsub";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";

const TOPIC = process.env.LOCAL_EVENTS_TOPIC || "primordia-local-events";
const SUBSCRIPTION = process.env.LOCAL_LAUNCHER_SUB || "primordia-local-launcher-sub";
const PUBSUB_EMULATOR = process.env.PUBSUB_EMULATOR_HOST || "pubsub:8083";

const NETWORK = process.env.DOCKER_NETWORK || "primordia_default";
const PROJECT_ID = process.env.PROJECT_ID || "ticktalk-472521";
const WORKSPACE_BUCKET = process.env.WORKSPACE_BUCKET || "primordia-bucket";
const STORAGE_EMULATOR = process.env.STORAGE_EMULATOR_HOST || "http://gcs:4443";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed:\n${res.stderr || res.stdout || "(no output)"}`);
  }
  return res.stdout.trim();
}

function startService(name) {
  const containerName = `primordia-local-service-${name}`;
  // Remove any old container quietly
  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });

  const inlineScript = `
set -euo pipefail
apk add --no-cache nodejs-current npm >/dev/null 2>&1 || true
mkdir -p /app && cd /app
node -e '
  const {Storage}=require("@google-cloud/storage");
  (async()=>{
    const s=new Storage({projectId:"${PROJECT_ID}", apiEndpoint:"${STORAGE_EMULATOR}"});
    const b=s.bucket(process.env.WORKSPACE_BUCKET);
    const files=["runs/${name}/index.js","runs/${name}/package.json","runs/${name}/handler.js"];
    for (const p of files) {
      try {
        const [buf]=await b.file(p).download();
        require("fs").writeFileSync(p.split("/").slice(-1)[0], buf);
      } catch (e) {
        if (p.endsWith("handler.js")) continue; // optional
        console.error("download-failed", p, e.message);
        process.exit(2);
      }
    }
  })().then(()=>{
    require("child_process").execSync("npm i --omit=dev", {stdio:"inherit"});
    require("child_process").execSync("node index.js", {stdio:"inherit"});
  }).catch(e=>{ console.error(e); process.exit(3); });
'
`;

  // Encode the script to avoid any quoting issues
  const b64 = Buffer.from(inlineScript, "utf8").toString("base64");

  try {
    run("docker", [
      "run",
      "-d",
      "--rm",
      "--name", containerName,
      "--network", NETWORK,
      "-e", `WORKSPACE_BUCKET=${WORKSPACE_BUCKET}`,
      "-e", `STORAGE_EMULATOR_HOST=${STORAGE_EMULATOR}`,
      "-e", `GCLOUD_PROJECT=${PROJECT_ID}`,
      "-p", "0:8080",
      "node:20-slim",
      "sh", "-lc",
      // decode to /tmp/start.sh and run it; base64 is available in busybox
      `echo ${b64} | base64 -d > /tmp/start.sh && sh /tmp/start.sh`
    ]);
  } catch (e) {
    // If docker run -p 0:8080 -p 0:8080 -p 0:8080 failed, dump any immediate logs from container name (in case it started then exited)
    try {
      const logs = run("docker", ["logs", containerName]);
      console.error("[local-launcher] container logs:\n", logs);
    } catch {}
    throw e;
  }

  const portLine = run("docker", ["port", containerName, "8080/tcp"]);
  const hostPort = portLine.split(":").pop().trim();
  console.log(`[local-launcher] STARTED ${name} on http://localhost:${hostPort} (container :8080)`);
}

async function main() {
  process.env.PUBSUB_EMULATOR_HOST = PUBSUB_EMULATOR;
  const pubsub = new PubSub({ projectId: PROJECT_ID });

  // Ensure topic/subscription exist (idempotent)
  const [topics] = await pubsub.getTopics();
  const hasTopic = topics.some((t) => t.name.endsWith(`/topics/${TOPIC}`));
  if (!hasTopic) await pubsub.createTopic(TOPIC);
  const topic = pubsub.topic(TOPIC);
  const [subs] = await topic.getSubscriptions().catch(() => [[], null]);
  const hasSub = Array.isArray(subs) && subs.some((s) => s.name.endsWith(`/subscriptions/${SUBSCRIPTION}`));
  if (!hasSub) await topic.createSubscription(SUBSCRIPTION);
  const sub = pubsub.subscription(SUBSCRIPTION);

  console.log(`[local-launcher] listening on ${TOPIC} (${SUBSCRIPTION}) via ${PUBSUB_EMULATOR}...`);

  sub.on("message", (m) => {
    try {
      const data = JSON.parse(m.data.toString("utf8"));
      if (data && data.type === "SERVICE_DEPLOYED" && data.name) {
        startService(data.name);
      }
    } catch (e) {
      console.error("[local-launcher] bad message:", e.message);
    } finally {
      m.ack();
    }
  });

  sub.on("error", (e) => console.error("[local-launcher] subscription error:", e.message));
}

main().catch((e) => { console.error("[local-launcher] fatal:", e); process.exit(1); });
