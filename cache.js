import fs from "fs";
import path from "path";
import { Firestore } from "@google-cloud/firestore";
import { CACHE_DIR, CACHE_COLLECTION, PROJECT_ID } from "./utils.js";

const db = new Firestore({ projectId: PROJECT_ID });

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

export const cache = {
  async set(key, data, persist = false) {
    const file = path.join(CACHE_DIR, `${key}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    if (persist) {
      await db.collection(CACHE_COLLECTION).doc(key).set({
        data,
        updatedAt: new Date().toISOString(),
      });
    }
  },
  get(key) {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  },
  async getPersistent(key) {
    const local = this.get(key);
    if (local) return local;
    const doc = await db.collection(CACHE_COLLECTION).doc(key).get();
    if (!doc.exists) return null;
    const data = doc.data()?.data;
    await this.set(key, data, false);
    return data;
  },
};
