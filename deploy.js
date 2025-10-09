import { CloudBuildClient } from "@google-cloud/cloudbuild";
import { PROJECT_ID, REGION } from "./utils.js";
import { cache } from "./cache.js";
import { downloadPrefixToTmp, zipDirectoryToGcs } from "./storage.js";
import { log } from "./utils.js";

const cloudBuild = new CloudBuildClient();

export async function deploy({ name, confirm, target = "cloudfunctions" }) {
  if (!confirm) throw new Error("Confirmation required");
  if (!name) throw new Error("Missing name");

  const isRun = target === "cloudrun";
  const prefix = isRun ? `runs/${name}/` : `functions/${name}/`;

  const cacheKey = `zip_${target}_${name}`;
  let zipRecord = await cache.getPersistent(cacheKey);
  let zipUri;
  if (zipRecord?.uri) {
    zipUri = zipRecord.uri;
    log(`[Deploy] Using cached source for ${name}: ${zipUri}`);
  } else {
    log(`[Deploy] Packaging source for ${name}...`);
    const localDir = await downloadPrefixToTmp(prefix);
    const dest = isRun ? `runs/${name}/service-source.zip` : `functions/${name}/function-source.zip`;
    zipUri = await zipDirectoryToGcs(localDir, dest);
    await cache.set(cacheKey, { uri: zipUri, updatedAt: new Date().toISOString() }, true);
    log(`[Deploy] Packaged source uploaded to: ${zipUri}`);
  }

  log(`[Deploy] Triggering Cloud Build for ${name}...`);
  const [operation] = await cloudBuild.createBuild({
    projectId: PROJECT_ID,
    build: {
      steps: [{
        name: "gcr.io/google.com/cloudsdktool/cloud-sdk",
        entrypoint: "bash",
        args: ["-lc", `
          set -euo pipefail
          echo ">>> Installing unzip..."
          apt-get update -qq && apt-get install -y -qq unzip > /dev/null
          echo ">>> Deploying ${name} to ${target}..."
          gsutil cp ${zipUri} /workspace/${name}.zip
          unzip /workspace/${name}.zip -d /workspace/${name}
          ${
            isRun
            // THIS IS THE CRITICAL CHANGE: The '--runtime=nodejs20' flag has been removed.
            ? `gcloud run deploy ${name} --source=/workspace/${name} --region=${REGION} --allow-unauthenticated --platform=managed --timeout=300`
            : `gcloud functions deploy ${name} --gen2 --region=${REGION} --runtime=nodejs20 --trigger-http --allow-unauthenticated --entry-point=main --memory=256MB --timeout=60s --source=/workspace/${name}`
          }
        `]
      }],
      timeout: { seconds: 1200 },
      options: {
        logging: "CLOUD_LOGGING_ONLY",
        machineType: "E2_HIGHCPU_8",
      },
    },
  });

  await cache.set(`deploy_${target}_${name}`, { operation: operation.name, startedAt: new Date().toISOString() }, true);

  return { success: true, status: "build_started", operation: operation.name, type: isRun ? "cloudrun" : "cloudfunctions" };
}
