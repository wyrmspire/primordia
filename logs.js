import { Logging } from "@google-cloud/logging";
import { PROJECT_ID } from "./utils.js";

const logging = new Logging({ projectId: PROJECT_ID });

export async function getBuildLogs({ buildId }) {
  if (!buildId) throw new Error("Missing buildId");

  const encodedUuid = buildId.split('/').pop();
  const actualBuildUuid = Buffer.from(encodedUuid, 'base64').toString('utf8');
  
  const filter = `resource.type="build" AND resource.labels.build_id="${actualBuildUuid}"`;
  
  const options = {
    filter: filter,
    orderBy: "timestamp desc",
    pageSize: 200,
  };

  try {
    const [entries] = await logging.getEntries(options);
    if (!entries.length) {
      return [`No logs found for build ID: ${actualBuildUuid}.`];
    }
    
    const formattedLogs = entries.reverse().map(entry => entry.data?.message || JSON.stringify(entry.data));
    
    return formattedLogs;
  } catch (err) {
    console.error("ERROR fetching logs from Cloud Logging:", err);
    throw new Error(`Could not retrieve build logs for ${actualBuildUuid}.`);
  }
}
