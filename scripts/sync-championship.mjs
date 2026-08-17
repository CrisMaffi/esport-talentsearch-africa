import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchSveltePageData,
  normalizeChampionship,
  persistSnapshot,
  selectSourceRecords,
  sourceEndpoints
} from "./lib/championship-data.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.resolve(
  process.env.CHAMPIONSHIP_CONFIG_PATH || path.join(projectRoot, "config", "championships.json")
);

async function syncChampionship(configuration, sourceBaseUrl, outputPath) {
  const championshipId = Number(configuration.id);
  const firstEndpoints = sourceEndpoints(sourceBaseUrl, championshipId);
  console.log("Fetching schedule:", firstEndpoints.schedule);
  console.log("Fetching standings:", firstEndpoints.standings);

  const [scheduleNodes, standingsNodes] = await Promise.all([
    fetchSveltePageData(firstEndpoints.schedule),
    fetchSveltePageData(firstEndpoints.standings)
  ]);

  const initial = selectSourceRecords(scheduleNodes, standingsNodes);
  const completedRounds = initial.schedule.rounds
    .filter((round) => round.completed || String(round.status).toLowerCase() === "closed")
    .sort((a, b) => Number(a.number) - Number(b.number));
  const latestRound = completedRounds.at(-1) || null;

  let resultNodes = [];
  if (latestRound) {
    const resultEndpoint = sourceEndpoints(sourceBaseUrl, championshipId, latestRound.id).latestResult;
    console.log("Fetching latest result:", resultEndpoint);
    resultNodes = await fetchSveltePageData(resultEndpoint);
  }

  const source = selectSourceRecords(scheduleNodes, standingsNodes, resultNodes);
  const candidate = normalizeChampionship(source, {
    championshipId,
    baseUrl: sourceBaseUrl,
    lastUpdated: new Date().toISOString()
  });

  const outcome = await persistSnapshot(candidate, outputPath);
  console.log(
    outcome.changed
      ? "Championship snapshot updated: " + outcome.outputPath
      : "No championship data changes detected; no file update required."
  );
}

async function main() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const sourceBaseUrl = process.env.CHAMPIONSHIP_SOURCE_BASE || config.sourceBaseUrl;
  const requestedId = process.env.CHAMPIONSHIP_ID || process.argv[2] || null;
  let championships = (config.championships || []).filter((item) => item.enabled);

  if (requestedId !== null) {
    championships = championships.filter((item) => Number(item.id) === Number(requestedId));
  }

  if (!championships.length) {
    throw new Error("No enabled championship matches the requested configuration.");
  }

  for (const championship of championships) {
    const configuredOutput = path.resolve(projectRoot, championship.output);
    const outputPath = process.env.CHAMPIONSHIP_DATA_PATH
      ? path.resolve(process.env.CHAMPIONSHIP_DATA_PATH)
      : configuredOutput;
    await syncChampionship(championship, sourceBaseUrl, outputPath);
  }
}

main().catch((error) => {
  console.error("Championship sync failed:", error.message);
  console.error("The last verified snapshot has been preserved.");
  process.exitCode = 1;
});
