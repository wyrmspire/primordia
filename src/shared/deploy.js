import { CloudBuildClient } from "@google-cloud/cloudbuild";
import { PROJECT_ID, REGION, BUCKET } from "./utils.js";
import { cache } from "./cache.js";
import { downloadPrefixToTmp, zipDirectoryToGcs } from "./storage.js";
import { log } from "./utils.js";

const cloudBuild = new CloudBuildClient();

export async function deploy({ name, confirm, target = "cloudfunctions", version = "latest", useCache = false }) {
  if (!confirm) throw new Error("Confirmation required");
  if (!name) throw new Error("Missing name");

  const isRun = target === "cloudrun";
  const prefix = `runs/${name}/`;

  const cacheKey = `zip_${target}_${name}`;
  let zipRecord = await cache.getPersistent(cacheKey);
  let zipUri;

  if (zipRecord?.uri && zipRecord?.version === version) {
    zipUri = zipRecord.uri;
    log(`[Deploy] Using cached source version '${version}' for ${name}: ${zipUri}`);
  } else {
    log(`[Deploy] Packaging new source version '${version}' for ${name}...`);
    const localDir = await downloadPrefixToTmp(prefix);
    const dest = isRun ? `runs/${name}/source-v${version}.zip` : `functions/${name}/source-v${version}.zip`;
    zipUri = await zipDirectoryToGcs(localDir, dest);
    await cache.set(cacheKey, { uri: zipUri, updatedAt: new Date().toISOString(), version: version }, true);
    log(`[Deploy] Packaged source uploaded to: ${zipUri}`);
  }

  log(`[Deploy] Triggering Cloud Build for ${name}...`);
  
  // Define the correct deployment command, including the WORKSPACE_BUCKET for Cloud Run
  const deployCommand = isRun
    ? `gcloud run deploy ${name} --source=/workspace/source --region=${REGION} --allow-unauthenticated --platform=managed --timeout=300 --set-env-vars=WORKSPACE_BUCKET=${BUCKET}`
    : `gcloud functions deploy ${name} --gen2 --region=${REGION} --runtime=nodejs20 --trigger-http --allow-unauthenticated --entry-point=main --memory=256MB --timeout=60s --source=/workspace/source`;

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
          gsutil cp ${zipUri} /workspace/source.zip
          unzip /workspace/source.zip -d /workspace/source
          ${deployCommand}
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
