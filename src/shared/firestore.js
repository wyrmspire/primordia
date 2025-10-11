import { Firestore } from "@google-cloud/firestore";
import { PROJECT_ID } from "./utils.js";
import { isSafePath } from "./utils.js";

// --- THE FIX ---
// Create the Firestore database client directly in this file.
const db = new Firestore({ projectId: PROJECT_ID });

const SANDBOX_COLLECTION = "gpt-workspace";
const SANDBOX_ROOT_DOC = "main";

function validateAndBuildDocPath(path) {
  if (!isSafePath(path)) {
    throw new Error("Invalid or unsafe Firestore path provided.");
  }
  const segments = path.split('/');
  if (segments.length === 0 || segments.length % 2 !== 0) {
      throw new Error(`Invalid document path: '${path}'. Paths must be in the format 'collection/doc'.`);
  }
  return `${SANDBOX_COLLECTION}/${SANDBOX_ROOT_DOC}/${path}`;
}

export async function getDocument(path) {
  const fullPath = validateAndBuildDocPath(path);
  const docRef = db.doc(fullPath);
  const doc = await docRef.get();
  if (!doc.exists) {
    return null;
  }
  return doc.data();
}

export async function setDocument(path, data) {
  const fullPath = validateAndBuildDocPath(path);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error("Invalid data payload; must be a non-empty object.");
  }
  const docRef = db.doc(fullPath);
  await docRef.set(data, { merge: true });
  return { success: true, path: fullPath };
}

export async function deleteDocument(path) {
  const fullPath = validateAndBuildDocPath(path);
  const docRef = db.doc(fullPath);
  await docRef.delete();
  return { success: true, path: fullPath };
}
