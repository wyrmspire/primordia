import { Firestore } from "@google-cloud/firestore";
import { scaffoldFunction, scaffoldRun } from "../shared/scaffold.js";
import { deploy } from "../shared/deploy.js";
import { PROJECT_ID } from "../shared/utils.js";

const db = new Firestore({ projectId: PROJECT_ID });
const JOBS_COLLECTION = process.env.TASKS_COLLECTION || "primordia_jobs";

async function logToJob(jobId, message) {
  console.log(`[Job:${jobId}] ${message}`);
  const jobRef = db.collection(JOBS_COLLECTION).doc(jobId);
  await jobRef.update({
    logs: Firestore.FieldValue.arrayUnion(`[${new Date().toISOString()}] ${message}`),
  });
}

// --- Individual Action Functions ---
async function executeScaffoldFunction(jobId, blueprint) {
  const { name } = blueprint;
  if (!name) throw new Error("Blueprint is missing 'name' for scaffold-function.");
  await logToJob(jobId, `Starting scaffold for function: ${name}`);
  return await scaffoldFunction({ name });
}

async function executeScaffoldRun(jobId, blueprint) {
  const { name } = blueprint;
  if (!name) throw new Error("Blueprint is missing 'name' for scaffold-run-service.");
  await logToJob(jobId, `Starting scaffold for Cloud Run service: ${name}`);
  return await scaffoldRun({ name });
}

async function executeDeployFunction(jobId, blueprint) {
    const { name } = blueprint;
    if (!name) throw new Error("Blueprint is missing 'name' for deploy-function.");
    await logToJob(jobId, `Starting deployment for function: ${name}`);
    return await deploy({ name, confirm: true, target: 'cloudfunctions' });
}

// NEW: Deploy a Cloud Run service
async function executeDeployRun(jobId, blueprint) {
    const { name } = blueprint;
    if (!name) throw new Error("Blueprint is missing 'name' for deploy-run-service.");
    await logToJob(jobId, `Starting deployment for Cloud Run service: ${name}`);
    return await deploy({ name, confirm: true, target: 'cloudrun' });
}

// --- Composite Functions ---
async function executeCreateAndDeployFunction(jobId, blueprint) {
    const { name } = blueprint;
    if (!name) throw new Error("Blueprint is missing 'name' for create-and-deploy-function.");
    await logToJob(jobId, `Composite Job Step 1/2: Scaffolding function '${name}'...`);
    const scaffoldResult = await executeScaffoldFunction(jobId, blueprint);
    await logToJob(jobId, `Composite Job Step 2/2: Deploying function '${name}'...`);
    const deployResult = await executeDeployFunction(jobId, blueprint);
    return { success: true, scaffoldResult, deployResult };
}

// NEW: Create and Deploy a Cloud Run service
async function executeCreateAndDeployRun(jobId, blueprint) {
    const { name } = blueprint;
    if (!name) throw new Error("Blueprint is missing 'name' for create-and-deploy-run-service.");
    await logToJob(jobId, `Composite Job Step 1/2: Scaffolding service '${name}'...`);
    const scaffoldResult = await executeScaffoldRun(jobId, blueprint);
    await logToJob(jobId, `Composite Job Step 2/2: Deploying service '${name}'...`);
    const deployResult = await executeDeployRun(jobId, blueprint);
    return { success: true, scaffoldResult, deployResult };
}

export async function runJob(job) {
  const { id: jobId, blueprint } = job;
  await logToJob(jobId, `Job runner picked up job. Type: ${blueprint.type}`);
  let result;

  switch (blueprint.type) {
    // Individual jobs
    case "scaffold-function": result = await executeScaffoldFunction(jobId, blueprint); break;
    case "scaffold-run-service": result = await executeScaffoldRun(jobId, blueprint); break;
    case "deploy-function": result = await executeDeployFunction(jobId, blueprint); break;
    case "deploy-run-service": result = await executeDeployRun(jobId, blueprint); break;
    
    // Composite jobs
    case "create-and-deploy-function": result = await executeCreateAndDeployFunction(jobId, blueprint); break;
    case "create-and-deploy-run-service": result = await executeCreateAndDeployRun(jobId, blueprint); break;
      
    default: throw new Error(`Unknown job type: '${blueprint.type}'`);
  }
  
  await logToJob(jobId, "Job completed successfully.");
  return result;
}
