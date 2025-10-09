import { Logging } from "@google-cloud/logging";
import { PROJECT_ID } from "./utils.js";

const logging = new Logging({ projectId: PROJECT_ID });

// This function retrieves and formats logs for a specific Cloud Build ID.
export async function getBuildLogs({ buildId }) {
  if (!buildId) throw new Error("Missing buildId");

  const filter = `resource.type="build" AND resource.labels.build_id="${buildId}"`;
  
  // We specify a descending order to get the most recent logs first.
  const options = {
    filter: filter,
    orderBy: "timestamp desc",
    pageSize: 200, // Get up to 200 of the most recent log lines
  };

  try {
    const [entries] = await logging.getEntries(options);
    if (!entries.length) {
      return [`No logs found for build ID: ${buildId}. The build may still be starting or the ID is incorrect.`];
    }
    
    // The logs are returned newest-first, so we reverse them to show in chronological order.
    // We extract the text payload for clean, readable output.
    const formattedLogs = entries.reverse().map(entry => entry.data?.message || JSON.stringify(entry.data));
    
    return formattedLogs;
  } catch (err) {
    console.error("ERROR fetching logs from Cloud Logging:", err);
    throw new Error("Could not retrieve build logs.");
  }
}
