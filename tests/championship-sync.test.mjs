import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  decodeSvelteData,
  normalizeChampionship,
  persistSnapshot,
  stablePayload,
  validateChampionshipData
} from "../scripts/lib/championship-data.mjs";

function sourceFixture() {
  return {
    metadata: {
      title: "AC Rally Challenge 2026",
      selectedChampId: 1,
      championships: [{ id: 1, name: "AC Rally Challenge 2026" }]
    },
    schedule: {
      timezone: "Africa/Addis_Ababa",
      rounds: [
        {
          id: 1,
          championship_id: 1,
          number: 1,
          title: "Greece",
          stage_name: "Elatia",
          stage_country: "GR",
          stage_length_km: 5,
          stage_surface: "Gravel",
          stage_notes: "Night",
          car_name: "Lancia Delta",
          practice_start: "2026-07-06T00:00",
          practice_end: "2026-07-12T23:59",
          ta_start: "2026-07-13T00:00",
          ta_end: "2026-07-16T23:59",
          status: "closed",
          completed: true,
          points_multiplier: 1
        },
        {
          id: 2,
          championship_id: 1,
          number: 2,
          title: "Wales",
          stage_name: "Hafren South",
          stage_country: "GB",
          stage_length_km: 4,
          stage_surface: "Gravel",
          stage_notes: null,
          car_name: "Skoda Fabia",
          practice_start: "2026-08-31T00:00",
          practice_end: "2026-09-06T23:59",
          ta_start: "2026-09-07T00:00",
          ta_end: "2026-09-13T23:59",
          status: "upcoming",
          completed: false,
          points_multiplier: 1
        }
      ]
    },
    standings: {
      rounds: [{ id: 1, number: 1, title: "Greece" }],
      standings: [
        {
          driverId: 11,
          totalPoints: 25,
          rank: 1,
          perRoundDetail: { "1": { position: 1, points: 25, timeMs: 201000 } },
          withdrawn: false,
          driver: { name: "Driver One", nationality: "ET", racing_number: 7 }
        }
      ]
    },
    result: {
      round: { id: 1 },
      board: [
        {
          driverId: 11,
          rank: 1,
          timeMs: 201000,
          driver: { name: "Driver One", nationality: "ET", racing_number: 7 }
        }
      ]
    }
  };
}

function snapshot() {
  return normalizeChampionship(sourceFixture(), {
    championshipId: 1,
    baseUrl: "https://simracing.ethiopianmotorsport.com",
    lastUpdated: "2026-08-17T12:00:00.000Z"
  });
}

test("decodes the flattened SvelteKit data format", () => {
  const decoded = decodeSvelteData([
    { title: 1, championshipId: 2, rounds: 3 },
    "Championship",
    1,
    [4],
    { id: 2, name: 5 },
    "Round One"
  ]);

  assert.deepEqual(decoded, {
    title: "Championship",
    championshipId: 1,
    rounds: [{ id: 1, name: "Round One" }]
  });
});

test("normalizes and validates current championship data", () => {
  const data = snapshot();
  assert.equal(data.championship.name, "AC Rally Challenge 2026");
  assert.equal(data.championship.completedRounds, 1);
  assert.equal(data.standings[0].wins, 1);
  assert.equal(data.latestResult.winner.driver, "Driver One");
  assert.equal(data.upcomingEvent.name, "Wales");
  assert.equal(data.events[0].practiceEnd, "2026-07-12T20:59:00.000Z");
  assert.doesNotThrow(() => validateChampionshipData(data));
});

test("supports a live championship before its first classified round", () => {
  const source = sourceFixture();
  source.metadata = {
    title: "F4 Challenge",
    selectedChampId: 2,
    championships: [{ id: 2, name: "F4 Challenge" }]
  };
  source.schedule.rounds = [{
    ...source.schedule.rounds[1],
    id: 21,
    championship_id: 2,
    number: 1,
    title: "Test",
    stage_name: "Okayama",
    car_name: "F4",
    practice_start: "2026-08-17T00:00",
    practice_end: "2026-08-22T23:59",
    ta_start: "2026-08-23T00:00",
    ta_end: "2026-08-23T23:59",
    status: "published",
    completed: false,
    points_multiplier: 0
  }];
  source.standings = { rounds: [], standings: [] };
  source.result = null;

  const data = normalizeChampionship(source, {
    championshipId: 2,
    baseUrl: "https://simracing.ethiopianmotorsport.com",
    lastUpdated: "2026-08-17T12:00:00.000Z"
  });

  assert.equal(data.championship.name, "F4 Challenge");
  assert.equal(data.events[0].status, "live");
  assert.equal(data.championship.completedRounds, 0);
  assert.equal(data.standings.length, 0);
  assert.doesNotThrow(() => validateChampionshipData(data));
});

test("rejects duplicate drivers and events", () => {
  const duplicateDriver = snapshot();
  duplicateDriver.standings.push({ ...duplicateDriver.standings[0], position: 2 });
  assert.throws(() => validateChampionshipData(duplicateDriver), /Duplicate driver/);

  const duplicateEvent = snapshot();
  duplicateEvent.events.push({ ...duplicateEvent.events[0] });
  duplicateEvent.championship.totalRounds += 1;
  duplicateEvent.championship.completedRounds += 1;
  assert.throws(() => validateChampionshipData(duplicateEvent), /Duplicate event/);
});

test("preserves the last good file when a candidate is invalid", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "etsa-championship-"));
  const outputPath = path.join(temporaryDirectory, "championship.json");
  const good = snapshot();

  try {
    const first = await persistSnapshot(good, outputPath);
    assert.equal(first.changed, true);
    const before = await readFile(outputPath, "utf8");

    const invalid = structuredClone(good);
    invalid.standings[0].points = Number.NaN;
    await assert.rejects(() => persistSnapshot(invalid, outputPath), /points are invalid/);

    const after = await readFile(outputPath, "utf8");
    assert.equal(after, before);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("does not report a change when only the sync timestamp differs", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "etsa-championship-"));
  const outputPath = path.join(temporaryDirectory, "championship.json");

  try {
    const first = snapshot();
    await persistSnapshot(first, outputPath);
    const second = { ...first, lastUpdated: "2026-08-18T12:00:00.000Z" };
    const outcome = await persistSnapshot(second, outputPath);
    assert.equal(outcome.changed, false);
    assert.equal(stablePayload(first), stablePayload(second));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
