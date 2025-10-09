import { db } from "./tasks.js";
import { isSafePath } from "./utils.js";

const SANDBOX_COLLECTION = "gpt-workspace";
// We create a single, stable document to act as the root of our sandbox.
// All user-provided paths will be subcollections of this document.
const SANDBOX_ROOT_DOC = "main";

function validateAndBuildDocPath(path) {
  if (!isSafePath(path)) {
    throw new Error("Invalid or unsafe Firestore path provided.");
  }
  // User path must be 'collection/doc'. 2 segments.
  const segments = path.split('/');
  if (segments.length === 0 || segments.length % 2 !== 0) {
      throw new Error(`Invalid document path: '${path}'. Paths must be in the format 'collection/doc' or 'collection/doc/subcollection/subdoc'.`);
  }
  // Final path: 'gpt-workspace/main/collection/doc'. 4 segments. VALID.
  return `${SANDBOX_COLLECTION}/${SANDBOX_ROOT_DOC}/${path}`;
}

function validateAndBuildCollectionPath(path) {
    if (!isSafePath(path)) {
        throw new Error("Invalid or unsafe Firestore path provided.");
    }
    // User path must be 'collection'. 1 segment.
    const segments = path.split('/');
    if (segments.length === 0 || segments.length % 2 === 0) {
        throw new Error(`Invalid collection path: '${path}'. Paths must point to a collection, e.g., 'my-collection' or 'collection/doc/subcollection'.`);
    }
    // Final path: 'gpt-workspace/main/collection'. 3 segments. VALID.
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
  const fullPath = validateAndBuildDocPath(path);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error("Invalid data payload; must be a non-empty object.");
  }
  const docRef = db.doc(fullPath);
  // Using { merge: true } is safer and allows for partial updates.
  await docRef.set(data, { merge: true });
  return { success: true, path: fullPath };
}

export async function deleteDocument(path) {
  const fullPath = validateAndBuildDocPath(path);
  const docRef = db.doc(fullPath);
  await docRef.delete();
  return { success: true, path: fullPath };
}
