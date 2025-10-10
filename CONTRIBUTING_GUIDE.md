# Collaboration Guide for the Primordia Project

This document outlines the development philosophy and core workflows for collaborating on the Primordia project. Following these guidelines is essential for maintaining consistency, clarity, and efficiency.

## Our Philosophy: Deterministic & Explicit

Our primary goal is to create a deterministic and reproducible workflow. We avoid ambiguity at all costs. This means we favor explicit commands and full context over abbreviated snippets or diffs. Every change should be clear, testable, and directly linked to a specific state of the codebase.

---

## Core Workflows

This is the required development loop for introducing any change.

### 1. The Local Development Loop (The "Pre-Flight Check")

To minimize costly and slow cloud deployments, we validate **all** changes locally first. This is non-negotiable.

1.  **Make Code Changes:** Modify the necessary files.
2.  **Start the Local Server:** In one terminal, run `export $(grep -v '^#' .env | xargs) && npm start`.
3.  **Run the Local Test Suite:** In a second terminal, execute the comprehensive test script: `./test-local.sh`.
4.  **Iterate Until It Passes:** Do not proceed until the local test suite passes with 100% success.

### 2. File Modifications: The `cat` Command

We exclusively use the `cat <<'EOF' > filename.js` command to replace files.

**Why we do this:**
- **Atomicity:** It replaces the entire file in one atomic operation, ensuring no partial states.
- **Clarity:** It represents the full and final state of the file. There is no need to interpret diffs or apply patches, which can lead to errors.
- **Reproducibility:** A `cat` command is a self-contained instruction that guarantees the exact same file content every time.

**How to do it:**
When providing a file update, always present it as a complete `cat` block, ready to be pasted into the terminal.

### 3. Version Control: The `git` Workflow

The `deploy.sh` script is hard-wired to fail if there are uncommitted changes in the Git repository. This is a critical safety feature.

**The required workflow is:**
1.  Ensure `./test-local.sh` passes.
2.  Add all your changes: `git add .`
3.  Commit your changes with a clear message: `git commit -m "feat: A clear description of the new feature"`
4.  Only then, run the deployment script: `./deploy.sh`

This ensures that every single deployment is tied directly to a specific commit in our history, providing a perfect audit trail.

---

## Project Overview: Primordia

### What Primordia Does (Current State)
Primordia is an API-driven cloud orchestration service with a powerful **hybrid execution engine**.

1.  **Cloud Services Orchestrator:** It can scaffold, deploy, and manage Google Cloud Functions and Cloud Run services.
2.  **Hard-Coded Task Runner:** It can execute stable, pre-compiled business logic (`tasks.js`) whose behavior is modified by external JSON configuration files stored in GCS.
3.  **Dynamic Script Runner:** It can securely execute arbitrary JavaScript code from external files (`scripts/*.js`) in a sandboxed Node.js `vm` context. This allows for changing service logic on the fly, without redeployment.

### What We Hope Primordia Will Do (Future Vision)
The goal is to evolve Primordia from a deterministic tool into an **Intelligent Cloud Agent**.

-   **Generative Scaffolding:** Instead of using static templates, Primordia will use a generative AI model to write tailored source code for new services based on a high-level prompt.
-   **AI-Powered Security Guardian:** It will analyze code for vulnerabilities and suggest IAM permissions *before* deployment, acting as an automated security reviewer.
-   **Autonomous Overseer:** It will monitor the health of the services it deploys, use a model to perform root cause analysis on failures, and eventually take self-healing actions like rolling back a failed deployment.

---

## File Structure Breakdown

This is a high-level overview of the key files in the project.

| File / Directory   | Purpose                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `index.js`         | The main Express.js server. Defines all API routes and orchestrates logic.     |
| `sandbox.js`       | The secure, native Node.js `vm` executor for the Dynamic Script Runner.        |
| `tasks.js`         | The registry of hard-coded functions for the Task Runner.                      |
| `storage.js`       | A library for interacting with Google Cloud Storage (GCS).                     |
| `firestore.js`     | A library for interacting with Firestore.                                      |
| `deploy.js`        | Contains the logic for triggering Cloud Build deployments.                     |
| `logs.js`          | Contains the logic for fetching and decoding Cloud Build logs.                 |
| `scaffold.js`      | Contains the logic for creating boilerplate templates for new services.        |
| `cloudbuild.yaml`  | The CI/CD pipeline definition for Cloud Build.                                 |
| `deploy.sh`        | The master script for committing and deploying the entire service.             |
| `test-local.sh`    | **Crucial:** The local test suite that must pass before any deployment.        |
| `.gcloudignore`    | Specifies which files to exclude from cloud deployments.                       |
| `.zipignore`       | Specifies which files to exclude from the `zip.sh` archive.                    |
| `zip.sh`           | Utility to create a clean, shareable `.zip` archive of the source code.        |
| `printcode.sh`     | Utility to print all source code into a single Markdown file.                  |
