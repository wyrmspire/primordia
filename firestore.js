import { db } from "./tasks.js";
import { isSafePath } from "./utils.js";

const SANDBOX_COLLECTION = "gpt-workspace";

function validateAndBuildPath(path) {
  if (!isSafePath(path)) {
    throw new Error("Invalid or unsafe Firestore path provided.");
  }
  return `${SANDBOX_COLLECTION}/${path}`;
}

export async function getDocument(path) {
  const fullPath = validateAndBuildPath(path);
  const docRef = db.doc(fullPath);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new Error(`Document not found at path: ${path}`);
  }
  return doc.data();
}

export async function listCollection(path) {
  const fullPath = validateAndBuildPath(path);
  const collectionRef = db.collection(fullPath);
  const snapshot = await collectionRef.get();
  if (snapshot.empty) {
    return [];
  }
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function setDocument(path, data) {
  const fullPath = validateAndBuildPath(path);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error("Invalid data payload; must be a non-empty object.");
  }
  const docRef = db.doc(fullPath);
  await docRef.set(data, { merge: true }); // Using merge to prevent accidental overwrites of fields
  return { success: true, path };
}

export async function deleteDocument(path) {
  const fullPath = validateAndBuildPath(path);
  const docRef = db.doc(fullPath);
  await docRef.delete();
  return { success: true, path };
}
