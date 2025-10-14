import 'dotenv/config';
import { PubSub } from '@google-cloud/pubsub';

async function main() {
  console.log(`--- Starting Pub/Sub Connection Test ---`);
  console.log(`Using Project ID: ${process.env.PROJECT_ID}`);
  try {
    const pubsub = new PubSub({ projectId: process.env.PROJECT_ID });
    const topicName = 'primordia-jobs';
    const topic = pubsub.topic(topicName);
    
    console.log(`Attempting to check if topic '${topicName}' exists...`);
    const [exists] = await topic.exists();
    
    if (exists) {
      console.log(`✅ SUCCESS: Successfully connected to Pub/Sub and found topic '${topicName}'.`);
    } else {
      console.log(`- Topic '${topicName}' does not exist. Attempting to create it...`);
      await topic.create();
      console.log(`✅ SUCCESS: Successfully created topic '${topicName}'.`);
    }
  } catch (err) {
    console.error("❌ FAILED: An error occurred during the Pub/Sub test.");
    console.error(err);
  }
}

main();
