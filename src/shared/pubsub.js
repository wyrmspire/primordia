import { PubSub } from "@google-cloud/pubsub";
import { PROJECT_ID } from "./utils.js";

// This will automatically connect to the emulator if PUBSUB_EMULATOR_HOST is set
// which it will be in our local dev environment.
const pubsub = new PubSub({ projectId: PROJECT_ID });

export async function publishMessage(topicName, message) {
  const dataBuffer = Buffer.from(JSON.stringify(message));
  try {
    const messageId = await pubsub.topic(topicName).publishMessage({ data: dataBuffer });
    console.log(`[PubSub] Message ${messageId} published to ${topicName}.`);
    return messageId;
  } catch (error) {
    console.error(`[PubSub] Received error while publishing: ${error.message}`);
    throw error;
  }
}

// Export the client instance for the worker to use for subscriptions
export { pubsub };
