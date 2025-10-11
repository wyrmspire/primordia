import { Firestore } from "@google-cloud/firestore";
import { runJob } from "./job-runner.js";
const db = new Firestore({ projectId: process.env.PROJECT_ID });
const JOBS_COLLECTION = process.env.TASKS_COLLECTION || "primordia_jobs";
import { pubsub } from '../shared/pubsub.js';
import 'dotenv/config';

if (!process.env.PROJECT_ID) {
    console.error("[Worker] FATAL: PROJECT_ID is not set. Make sure .env file is available.");
    process.exit(1);
}

const TOPIC_NAME = "primordia-jobs";
const SUBSCRIPTION_NAME = "primordia-worker-sub";

async function setupSubscription() {
  const topic = pubsub.topic(TOPIC_NAME);
  try {
      const [topicExists] = await topic.exists();
      if (!topicExists) {
        console.log(`[Worker] Topic ${topic.name} not found. Creating...`);
        await topic.create();
        console.log(`[Worker] Topic ${topic.name} created.`);
      }

      const subscription = topic.subscription(SUBSCRIPTION_NAME);
      const [subExists] = await subscription.exists();
      if (!subExists) {
        console.log(`[Worker] Subscription ${subscription.name} not found. Creating...`);
        await subscription.create();
        console.log(`[Worker] Subscription ${subscription.name} created.`);
      }
      return subscription;
  } catch (error) {
      console.error("[Worker] Error during topic/subscription setup:", error);
      throw error;
  }
}

function listenForMessages(subscription) {
  console.log(`[Worker] 🎧 Listening for messages on ${subscription.name}...`);

  subscription.on('message', async message => {
    console.log('--- [Worker] Message Received ---');
    console.log(`  ID: ${message.id}`);
    
    let jobId = null;
    try {
      const payload = JSON.parse(message.data.toString());
      jobId = payload.jobId;

      const jobRef = db.collection(JOBS_COLLECTION).doc(jobId);
      const jobDoc = await jobRef.get();
      if (!jobDoc.exists) throw new Error(`Job ${jobId} not found in Firestore.`);

      await jobRef.update({ status: "RUNNING", startedAt: new Date().toISOString() });
      const result = await runJob({ id: jobDoc.id, ...jobDoc.data() });
      await jobRef.update({ status: "SUCCESS", completedAt: new Date().toISOString(), outputs: result });

    } catch (err) {
      console.error(`  [Job:${jobId}] 🔥 JOB FAILED:`, err.message);
      if (jobId) {
        const jobRef = db.collection(JOBS_COLLECTION).doc(jobId);
        await jobRef.update({
          status: "FAILED",
          completedAt: new Date().toISOString(),
          logs: Firestore.FieldValue.arrayUnion(`[${new Date().toISOString()}] ERROR: ${err.message}`),
        });
      }
    }
    
    console.log('-------------------------------');
    message.ack();
  });

  subscription.on('error', error => {
    console.error('[Worker] Subscription error:', error);
  });
}

async function main() {
  console.log("🛠️ Primordia Worker starting...");
  try {
    const subscription = await setupSubscription();
    listenForMessages(subscription);
  } catch (error) {
    console.error("[Worker] FATAL: Could not start listener:", error);
    process.exit(1);
  }
}

main();
