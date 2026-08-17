import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicPages = [
  "index.html",
  "digital-grand-prix.html",
  "events.html",
  "contact.html",
  "championship.html"
];
const requiredFiles = [
  ...publicPages,
  "assets/championship.css",
  "assets/championship.js",
  "data/championship.json",
  "data/championship-f4.json",
  "sitemap.xml",
  "robots.txt"
];

const failures = [];

for (const file of requiredFiles) {
  try {
    await access(path.join(projectRoot, file));
  } catch {
    failures.push("Missing required file: " + file);
  }
}

for (const page of publicPages) {
  const html = await readFile(path.join(projectRoot, page), "utf8");
  if (!html.includes("championship.html")) {
    failures.push("Live Championship navigation is missing from " + page);
  }
  if (!/<meta\s+name="viewport"/i.test(html)) {
    failures.push("Responsive viewport metadata is missing from " + page);
  }
}

const championshipHtml = await readFile(path.join(projectRoot, "championship.html"), "utf8");
[
  "assets/championship.css",
  "assets/championship.js",
  "standings-body",
  "schedule-grid",
  "last-updated",
  "id=\"championship-select\"",
  "option value=\"rally\"",
  "option value=\"f4\"",
  "https://esport.ethiopianmotorsport.com/"
].forEach((marker) => {
  if (!championshipHtml.includes(marker)) {
    failures.push("Championship page is missing marker: " + marker);
  }
});

const digitalGrandPrixHtml = await readFile(path.join(projectRoot, "digital-grand-prix.html"), "utf8");
[
  "Driver Telemetry &amp; Coaching Tool",
  "Rig Calibration &amp; Scrutineering Tool",
  "Same driver. Same declared conditions. Different result.",
  "Project 1 or Project 2 as separate submissions"
].forEach((marker) => {
  if (!digitalGrandPrixHtml.includes(marker)) {
    failures.push("Digital Grand Prix page is missing marker: " + marker);
  }
});

const sitemap = await readFile(path.join(projectRoot, "sitemap.xml"), "utf8");
if (!sitemap.includes("/championship.html")) {
  failures.push("Championship page is missing from sitemap.xml");
}

const robots = await readFile(path.join(projectRoot, "robots.txt"), "utf8");
if (!robots.includes("Sitemap:")) {
  failures.push("robots.txt no longer exposes the sitemap.");
}

const workflow = await readFile(
  path.join(projectRoot, ".github", "workflows", "sync-championship.yml"),
  "utf8"
);
["cron: \"0 6 * * *\"", "workflow_dispatch:", "npm run championship:sync", "git status --porcelain"].forEach((marker) => {
  if (!workflow.includes(marker)) {
    failures.push("Championship workflow is missing marker: " + marker);
  }
});
if (workflow.includes("\\${{")) {
  failures.push("GitHub Actions expression contains an invalid escape.");
}

if (failures.length) {
  failures.forEach((failure) => console.error(failure));
  process.exitCode = 1;
} else {
  console.log("Static site, navigation, SEO discovery and workflow checks passed.");
}
