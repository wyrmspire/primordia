import { PubSub } from "@google-cloud/pubsub";
import { Firestore } from "@google-cloud/firestore";
import { log } from "../shared/utils.js";
import { runJob } from "./job-runner.js";
const PROJECT_ID = process.env.PROJECT_ID;
const TOPIC_ID = process.env.PUBSUB_TOPIC || "primordia-builds";
const SUBSCRIPTION_ID = process.env.PUBSUB_SUB || "primordia-worker-sub";
const JOBS_COLLECTION = process.env.TASKS_COLLECTION || "primordia_jobs";
if (!PROJECT_ID) { throw new Error("[Worker FATAL] PROJECT_ID env var is required"); }
const pubsub = new PubSub({ projectId: PROJECT_ID });
const db = new Firestore({ projectId: PROJECT_ID });
async function fetchJob(jobId) { const ref = db.collection(JOBS_COLLECTION).doc(jobId); const snap = await ref.get(); if (!snap.exists) throw new Error(`Job ${jobId} not found`); return { id: jobId, ...snap.data() }; }
export async function startWorker() { log("🛠️ Primordia Worker starting..."); const { subscription } = await pubsub.topic(TOPIC_ID).subscription(SUBSCRIPTION_ID).get({ autoCreate: true }).then(d => ({ subscription: d[0] })); subscription.on("message", async (message) => { let jobId = null; try { const data = JSON.parse(message.data.toString() || "{}"); if (data.jobId) { jobId = data.jobId; const jobRef = db.collection(JOBS_COLLECTION).doc(jobId); await jobRef.update({ status: 'RUNNING', startedAt: new Date().toISOString() }); const jobDoc = await fetchJob(jobId); await runJob({ id: jobDoc.jobId || jobDoc.id, blueprint: jobDoc.blueprint }); await jobRef.update({ status: 'SUCCESS', completedAt: new Date().toISOString() }); } } catch (err) { log("[Worker] Job error:", err?.message || String(err)); if (jobId) { const jobRef = db.collection(JOBS_COLLECTION).doc(jobId); await jobRef.update({ status: 'FAILED', completedAt: new Date().toISOString(), logs: Firestore.FieldValue.arrayUnion(`[ERROR] ${err.message}`) }); } } finally { message.ack(); } }); subscription.on("error", (err) => { log("[Worker] Subscription error:", err); process.exit(1); }); }
if (process.env.NODE_ENV !== "test") { startWorker().catch((err) => { log("[Worker] FATAL during startup:", err); process.exit(1); }); }
