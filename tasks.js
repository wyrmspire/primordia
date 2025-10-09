import { Firestore } from "@google-cloud/firestore";
import { PROJECT_ID, TASKS_COLLECTION } from "./utils.js";

const db = new Firestore({ projectId: PROJECT_ID });

export async function logTask(type, data) {
  const doc = await db.collection(TASKS_COLLECTION).add({
    type,
    data,
    timestamp: new Date().toISOString(),
    status: "started",
  });
  return doc.id;
}

export async function updateTask(id, updates) {
  await db.collection(TASKS_COLLECTION).doc(id).set(updates, { merge: true });
}

export async function getTask(id) {
  const doc = await db.collection(TASKS_COLLECTION).doc(id).get();
  return doc.exists ? doc.data() : null;
}
