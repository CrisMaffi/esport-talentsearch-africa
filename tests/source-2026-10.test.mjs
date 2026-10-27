// Regression tests built from real provider responses captured on
// 2026-10-27, after the provider moved its routes (old URLs now return a
// SvelteKit redirect payload), changed the championship metadata shape and
// introduced race-format rounds. These broke the daily sync from 2026-10-20.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  fetchSveltePageData,
  normalizeChampionship,
  selectSourceRecords,
  sourceEndpoints,
  svelteDataUrlForLocation,
  validateChampionshipData
} from "../scripts/lib/championship-data.mjs";

const BASE = "https://simracing.ethiopianmotorsport.com";
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "source-2026-10");

async function loadFixtures() {
  const responses = new Map();
  for (const file of await readdir(fixtureDir)) {
    const { url, body } = JSON.parse(await readFile(path.join(fixtureDir, file), "utf8"));
    responses.set(url, JSON.stringify(body));
  }
  return responses;
}

function fakeFetch(responses, requested = []) {
  return async (url) => {
    requested.push(url);
    const body = responses.get(url);
    if (body === undefined) {
      return new Response("Not found: " + url, { status: 404, headers: { "content-type": "text/plain" } });
    }
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  };
}

async function syncFromFixtures(championshipId, roundId, lastUpdated) {
  const responses = await loadFixtures();
  const fetchImpl = fakeFetch(responses);
  const endpoints = sourceEndpoints(BASE, championshipId, roundId);
  const [scheduleNodes, standingsNodes, resultNodes] = await Promise.all([
    fetchSveltePageData(endpoints.schedule, fetchImpl),
    fetchSveltePageData(endpoints.standings, fetchImpl),
    fetchSveltePageData(endpoints.latestResult, fetchImpl)
  ]);
  const source = selectSourceRecords(scheduleNodes, standingsNodes, resultNodes);
  return normalizeChampionship(source, { championshipId, baseUrl: BASE, lastUpdated });
}

test("endpoints point at the current provider routes", () => {
  const endpoints = sourceEndpoints(BASE, 2, 10);
  assert.equal(endpoints.schedule, BASE + "/championships/2/calendar/__data.json");
  assert.equal(endpoints.standings, BASE + "/championships/2/standings/__data.json");
  assert.equal(endpoints.latestResult, BASE + "/championships/2/__data.json?round=10&week=time_attack");
});

test("follows SvelteKit redirect payloads from the legacy routes", async () => {
  const responses = await loadFixtures();
  const requested = [];
  const nodes = await fetchSveltePageData(BASE + "/schedule/__data.json?champ=2", fakeFetch(responses, requested));
  assert.deepEqual(requested, [
    BASE + "/schedule/__data.json?champ=2",
    BASE + "/championships/2/calendar/__data.json"
  ]);
  assert.ok(nodes.some((node) => node && Array.isArray(node.rounds)));
});

test("redirects are restricted to the same origin and bounded", async () => {
  assert.throws(
    () => svelteDataUrlForLocation(BASE + "/schedule/__data.json", "https://evil.example/x"),
    /different origin/
  );
  assert.equal(
    svelteDataUrlForLocation(BASE + "/__data.json?champ=1", "/championships/1?round=6"),
    BASE + "/championships/1/__data.json?round=6"
  );

  const loop = JSON.stringify({ type: "redirect", location: "/loop" });
  const fetchImpl = async () => new Response(loop, { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(fetchSveltePageData(BASE + "/loop/__data.json", fetchImpl), /redirected more than/);
});

test("still reports a clear error for an unknown payload type", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ type: "error", error: { message: "boom" } }), {
    status: 200, headers: { "content-type": "application/json" }
  });
  await assert.rejects(fetchSveltePageData(BASE + "/x/__data.json", fetchImpl), /Unexpected source schema.*payload type: error/);
});

test("syncs the F4 championship including a race-format round", async () => {
  const data = await syncFromFixtures(2, 10, "2026-10-27T12:00:00.000Z");
  validateChampionshipData(data);

  assert.equal(data.championship.name, "F4 Challenge 2026");
  assert.equal(data.championship.season, "2026");
  assert.equal(data.championship.totalRounds, 5);
  assert.equal(data.championship.completedRounds, 3);
  assert.equal(data.source.publicUrl, BASE + "/championships/2/calendar");

  const greatBritain = data.events.find((event) => event.id === 10);
  assert.equal(greatBritain.format, "race");
  assert.equal(greatBritain.status, "completed");
  assert.equal(greatBritain.resultUrl, BASE + "/championships/2?round=10");

  assert.equal(data.latestResult.round, 3);
  assert.equal(data.latestResult.format, "race");
  assert.deepEqual(
    data.latestResult.podium.map((entry) => [entry.position, entry.driver]),
    [[1, "Kebron Bereket"], [2, "Saverio Gulla"], [3, "Emilio Graffi"]]
  );
  assert.equal(data.latestResult.winner.country, "ER", "nationality is joined from standings");
  assert.equal(data.standings[0].driver, "Kebron Bereket");
  assert.equal(data.standings[0].wins, 2);
  assert.equal(data.upcomingEvent.name, "Spain");
});

test("syncs the rally championship with a round in its practice week", async () => {
  const data = await syncFromFixtures(1, 5, "2026-10-27T12:00:00.000Z");
  validateChampionshipData(data);

  assert.equal(data.championship.name, "AC Rally Challenge 2026");
  assert.equal(data.championship.completedRounds, 5);
  assert.equal(data.latestResult.round, 5);
  assert.equal(data.latestResult.podium.length, 3);
  assert.equal(data.latestResult.podium[0].driver, "Saverio Gulla");
  assert.equal(data.events.find((event) => event.id === 6).status, "live");
  assert.equal(data.events.find((event) => event.id === 5).resultUrl, BASE + "/championships/1?round=5&week=time_attack");
});

test("rejects a source that returns a different championship", async () => {
  const responses = await loadFixtures();
  const fetchImpl = fakeFetch(responses);
  const endpoints = sourceEndpoints(BASE, 2, 10);
  const source = selectSourceRecords(
    await fetchSveltePageData(endpoints.schedule, fetchImpl),
    await fetchSveltePageData(endpoints.standings, fetchImpl),
    await fetchSveltePageData(endpoints.latestResult, fetchImpl)
  );
  assert.throws(
    () => normalizeChampionship(source, { championshipId: 1, baseUrl: BASE }),
    /different championship/
  );
});
