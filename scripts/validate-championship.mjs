import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateChampionshipData } from "./lib/championship-data.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.resolve(
  process.env.CHAMPIONSHIP_CONFIG_PATH || path.join(projectRoot, "config", "championships.json")
);

try {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const requestedId = process.env.CHAMPIONSHIP_ID || null;
  let championships = (config.championships || []).filter((item) => item.enabled);

  if (requestedId !== null) {
    championships = championships.filter((item) => Number(item.id) === Number(requestedId));
  }

  if (!championships.length) {
    throw new Error("No enabled championship matches the requested configuration.");
  }

  for (const championship of championships) {
    const dataPath = process.env.CHAMPIONSHIP_DATA_PATH
      ? path.resolve(process.env.CHAMPIONSHIP_DATA_PATH)
      : path.resolve(projectRoot, championship.output);
    const snapshot = JSON.parse(await readFile(dataPath, "utf8"));
    validateChampionshipData(snapshot);
    if (snapshot.source.championshipId !== Number(championship.id)) {
      throw new Error("Snapshot championship ID does not match " + dataPath);
    }
    console.log("Championship snapshot is valid:", dataPath);
  }
} catch (error) {
  console.error("Championship validation failed:", error.message);
  process.exitCode = 1;
}
