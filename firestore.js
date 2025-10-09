import { db } from "./tasks.js";
import { isSafePath } from "./utils.js";

const SANDBOX_COLLECTION = "gpt-workspace";

function validateAndBuildPath(path) {
  if (!isSafePath(path)) {
    throw new Error("Invalid or unsafe Firestore path provided.");
  }
  // A valid doc path must have an even number of segments.
  // 'collection/doc' -> 2 segments. OK.
  // 'collection/doc/subcollection/subdoc' -> 4 segments. OK.
  const segments = path.split('/');
  if (segments.length % 2 !== 0) {
      throw new Error(`Invalid document path: ${path}. Paths must have an even number of segments.`);
  }
  return `${SANDBOX_COLLECTION}/${path}`;
}

function validateAndBuildCollectionPath(path) {
    if (!isSafePath(path)) {
        throw new Error("Invalid or unsafe Firestore path provided.");
    }
    const segments = path.split('/');
    if (segments.length % 2 === 0) {
        throw new Error(`Invalid collection path: ${path}. Paths must have an odd number of segments.`);
    }
    return `${SANDBOX_COLLECTION}/${path}`;
}


export async function getDocument(path) {
  const fullPath = validateAndBuildPath(path);
  const docRef = db.doc(fullPath);
  const doc = await docRef.get();
  if (!doc.exists) {
    // Return null instead of throwing an error for a more flexible API
    return null;
  }
  return doc.data();
}

export async function listCollection(path) {
  const fullPath = validateAndBuildCollectionPath(path);
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
  await docRef.set(data, { merge: true });
  return { success: true, path };
}

export async function deleteDocument(path) {
  const fullPath = validateAndBuildPath(path);
  const docRef = db.doc(fullPath);
  await docRef.delete();
  return { success: true, path };
}
