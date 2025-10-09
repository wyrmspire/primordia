import { Logging } from "@google-cloud/logging";
import { PROJECT_ID } from "./utils.js";

const logging = new Logging({ projectId: PROJECT_ID });

export async function getBuildLogs({ buildId }) {
  if (!buildId) throw new Error("Missing buildId");

  // CRITICAL FIX: The buildId from the API is the full operation name,
  // e.g., "operations/build/ticktalk-472521/some-long-uuid".
  // The logging filter needs ONLY the final UUID part.
  const actualBuildUuid = buildId.split('/').pop();

  const filter = `resource.type="build" AND resource.labels.build_id="${actualBuildUuid}"`;
  
  const options = {
    filter: filter,
    orderBy: "timestamp desc",
    pageSize: 200,
  };

  try {
    const [entries] = await logging.getEntries(options);
    if (!entries.length) {
      return [`No logs found for build ID: ${actualBuildUuid}. The build may still be starting, the ID is incorrect, or logs have not propagated.`];
    }
    
    const formattedLogs = entries.reverse().map(entry => entry.data?.message || JSON.stringify(entry.data));
    
    return formattedLogs;
  } catch (err) {
    console.error("ERROR fetching logs from Cloud Logging:", err);
    throw new Error("Could not retrieve build logs.");
  }
}
