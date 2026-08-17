import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_SOURCE_BYTES = 5_000_000;
const VALID_EVENT_STATUSES = new Set(["completed", "live", "upcoming"]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseSeason(title) {
  const match = String(title || "").match(/\b(20\d{2})\b/);
  return match ? match[1] : null;
}

function isoOrNull(value, timezone = null) {
  if (!value) return null;
  let timestamp = String(value).trim().replace(" ", "T");
  const hasExplicitZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp);
  if (!hasExplicitZone && timezone === "Africa/Addis_Ababa") {
    timestamp += "+03:00";
  }
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function trustedUrl(baseUrl, pathname, params) {
  const url = new URL(pathname, baseUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.toString();
}

export function decodeSvelteData(input) {
  assert(Array.isArray(input), "Svelte data payload must be a flattened array.");
  const hydrated = new Array(input.length);
  const inProgress = new Set();

  function hydrate(reference) {
    if (reference === -1) return undefined;
    if (reference === -2) return Number.NaN;
    if (reference === -3) return Number.POSITIVE_INFINITY;
    if (reference === -4) return Number.NEGATIVE_INFINITY;
    if (reference === -5) return -0;

    assert(
      Number.isInteger(reference) && reference >= 0 && reference < input.length,
      "Invalid Svelte data reference: " + reference
    );

    if (Object.prototype.hasOwnProperty.call(hydrated, reference)) {
      return hydrated[reference];
    }

    if (inProgress.has(reference)) {
      return hydrated[reference];
    }

    inProgress.add(reference);
    const raw = input[reference];

    if (Array.isArray(raw)) {
      const output = [];
      hydrated[reference] = output;
      raw.forEach((value) => {
        output.push(typeof value === "number" ? hydrate(value) : value);
      });
    } else if (raw && typeof raw === "object") {
      const output = {};
      hydrated[reference] = output;
      Object.entries(raw).forEach(([key, value]) => {
        output[key] = typeof value === "number" ? hydrate(value) : value;
      });
    } else {
      hydrated[reference] = raw;
    }

    inProgress.delete(reference);
    return hydrated[reference];
  }

  return hydrate(0);
}

export async function fetchSveltePageData(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": "ETSA-Championship-Sync/1.0"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000)
  });

  assert(response.ok, "Source request failed with HTTP " + response.status + " for " + url);
  const contentType = response.headers.get("content-type") || "";
  assert(contentType.includes("application/json"), "Source did not return JSON for " + url);

  const contentLength = finiteNumber(response.headers.get("content-length"), 0);
  assert(contentLength <= MAX_SOURCE_BYTES, "Source response is larger than the safety limit.");

  const text = await response.text();
  assert(text.length > 0 && text.length <= MAX_SOURCE_BYTES, "Source response size is invalid.");

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Source returned malformed JSON for " + url);
  }

  assert(payload && payload.type === "data" && Array.isArray(payload.nodes), "Unexpected source schema.");

  return payload.nodes
    .filter((node) => node && node.type === "data" && Array.isArray(node.data))
    .map((node) => decodeSvelteData(node.data));
}

export function sourceEndpoints(baseUrl, championshipId, roundId = null) {
  const base = new URL(baseUrl);
  const id = Number(championshipId);
  assert(Number.isInteger(id) && id > 0, "Championship ID must be a positive integer.");

  const endpoints = {
    schedule: trustedUrl(base, "/schedule/__data.json", { champ: id }),
    standings: trustedUrl(base, "/standings/__data.json", { champ: id })
  };

  if (roundId !== null) {
    endpoints.latestResult = trustedUrl(base, "/__data.json", {
      champ: id,
      round: roundId,
      week: "time_attack"
    });
  }

  return endpoints;
}

export function selectSourceRecords(scheduleNodes, standingsNodes, resultNodes = []) {
  const metadata = scheduleNodes.find(
    (node) => node && node.title && Array.isArray(node.championships)
  );
  const schedule = scheduleNodes.find(
    (node) => node && Array.isArray(node.rounds) && node.rounds.some((round) => round.practice_start)
  );
  const standings = standingsNodes.find(
    (node) => node && Array.isArray(node.standings) && Array.isArray(node.rounds)
  );
  const result = resultNodes.find(
    (node) => node && Array.isArray(node.board) && node.round
  ) || null;

  assert(metadata, "Championship metadata is missing from the schedule source.");
  assert(schedule, "Championship rounds are missing from the schedule source.");
  assert(standings, "Driver standings are missing from the standings source.");

  return { metadata, schedule, standings, result };
}

function normalizeEvent(round, championshipId, baseUrl, timezone, referenceTime) {
    const rawStatus = cleanText(round.status) || "unknown";
    let status = "upcoming";
    const practiceStart = isoOrNull(round.practice_start, timezone);
    const endDate = isoOrNull(round.ta_end, timezone);

    if (round.completed || ["closed", "completed", "final"].includes(rawStatus.toLowerCase())) {
      status = "completed";
    } else if (["live", "active", "open", "running"].includes(rawStatus.toLowerCase())) {
      status = "live";
    } else if (
      Number.isFinite(referenceTime) &&
      Number.isFinite(Date.parse(practiceStart)) &&
      Number.isFinite(Date.parse(endDate)) &&
      referenceTime >= Date.parse(practiceStart) &&
      referenceTime <= Date.parse(endDate)
    ) {
      status = "live";
  }

  const resultUrl = status === "completed"
    ? trustedUrl(baseUrl, "/", {
        champ: championshipId,
        round: round.id,
        week: "time_attack"
      })
    : null;

  return {
    id: finiteNumber(round.id),
    round: finiteNumber(round.number),
    name: cleanText(round.title),
    track: cleanText(round.stage_name),
    country: cleanText(round.stage_country),
    lengthKm: finiteNumber(round.stage_length_km),
    surface: cleanText(round.stage_surface),
    notes: cleanText(round.stage_notes),
    car: cleanText(round.car_name),
    practiceStart,
    practiceEnd: isoOrNull(round.practice_end, timezone),
    startDate: isoOrNull(round.ta_start, timezone),
    endDate,
    status,
    sourceStatus: rawStatus,
    pointsMultiplier: finiteNumber(round.points_multiplier, 1),
    resultUrl
  };
}

function normalizeStanding(row, index) {
  const details = Object.values(row.perRoundDetail || {});
  const positions = details
    .map((detail) => finiteNumber(detail && detail.position))
    .filter((position) => Number.isInteger(position) && position > 0);

  return {
    id: finiteNumber(row.driverId),
    position: finiteNumber(row.rank, index + 1),
    driver: cleanText(row.driver && row.driver.name),
    country: cleanText(row.driver && row.driver.nationality),
    racingNumber: finiteNumber(row.driver && row.driver.racing_number),
    points: finiteNumber(row.totalPoints, 0),
    wins: positions.filter((position) => position === 1).length,
    podiums: positions.filter((position) => position <= 3).length,
    eventsEntered: details.length,
    withdrawn: Boolean(row.withdrawn)
  };
}

function normalizePodium(board) {
  return [...(board || [])]
    .filter((entry) => Number.isInteger(finiteNumber(entry.rank)) && finiteNumber(entry.rank) <= 3)
    .sort((a, b) => finiteNumber(a.rank) - finiteNumber(b.rank))
    .map((entry) => ({
      position: finiteNumber(entry.rank),
      driver: cleanText(entry.driver && entry.driver.name),
      country: cleanText(entry.driver && entry.driver.nationality),
      racingNumber: finiteNumber(entry.driver && entry.driver.racing_number),
      timeMs: finiteNumber(entry.timeMs)
    }));
}

export function normalizeChampionship(source, options) {
  const championshipId = Number(options.championshipId);
  const baseUrl = new URL(options.baseUrl).toString();
  const publicUrl = trustedUrl(baseUrl, "/schedule", { champ: championshipId });
  const { metadata, schedule, standings, result } = source;

  assert(
    Number(metadata.selectedChampId) === championshipId,
    "The source returned a different championship than requested."
  );

  const selected = metadata.championships.find((item) => Number(item.id) === championshipId);
  const championshipName = cleanText(selected && selected.name) || cleanText(metadata.title);
  const timezone = cleanText(schedule.timezone) || "Africa/Addis_Ababa";
  const lastUpdated = options.lastUpdated || new Date().toISOString();
  const referenceTime = Date.parse(lastUpdated);
  const events = schedule.rounds
    .filter((round) => Number(round.championship_id) === championshipId)
    .map((round) => normalizeEvent(round, championshipId, baseUrl, timezone, referenceTime))
    .sort((a, b) => a.round - b.round);
  const completedEvents = events.filter((event) => event.status === "completed");
  const pendingEvents = events.filter((event) => event.status !== "completed");
  const latestEvent = completedEvents.at(-1) || null;
  const upcomingEvent = pendingEvents
    .sort((a, b) => Date.parse(a.practiceStart) - Date.parse(b.practiceStart))[0] || null;
  const normalizedStandings = standings.standings
    .map(normalizeStanding)
    .sort((a, b) => a.position - b.position);
  const podium = normalizePodium(result && result.board);

  if (latestEvent) {
    assert(result && Number(result.round.id) === latestEvent.id, "Latest result does not match the latest completed round.");
  }

  const latestResult = latestEvent
    ? {
        round: latestEvent.round,
        eventName: latestEvent.name,
        date: latestEvent.endDate,
        track: latestEvent.track,
        resultUrl: latestEvent.resultUrl,
        winner: podium[0] || null,
        podium
      }
    : null;

  const endpoints = sourceEndpoints(baseUrl, championshipId, latestEvent && latestEvent.id);

  return {
    schemaVersion: 1,
    source: {
      provider: "Ethiopian Motorsport",
      championshipId,
      publicUrl,
      endpoints
    },
    championship: {
      id: championshipId,
      name: championshipName,
      season: parseSeason(championshipName),
      timezone,
      totalRounds: events.length,
      completedRounds: completedEvents.length,
      currentLeader: normalizedStandings[0] || null,
      lastCompletedEvent: latestEvent
        ? {
            round: latestEvent.round,
            name: latestEvent.name,
            date: latestEvent.endDate
          }
        : null,
      upcomingRound: upcomingEvent
        ? {
            round: upcomingEvent.round,
            name: upcomingEvent.name,
            date: upcomingEvent.practiceStart
          }
        : null
    },
    standings: normalizedStandings,
    events,
    latestResult,
    upcomingEvent,
    lastUpdated
  };
}

function validateDate(value, label, required = true) {
  if (value === null && !required) return;
  assert(typeof value === "string" && Number.isFinite(Date.parse(value)), label + " is not a valid date.");
}

export function validateChampionshipData(data) {
  assert(data && typeof data === "object", "Championship snapshot must be an object.");
  assert(data.schemaVersion === 1, "Unsupported championship schema version.");
  assert(data.source && data.source.provider === "Ethiopian Motorsport", "Source provider is invalid.");
  assert(Number.isInteger(data.source.championshipId) && data.source.championshipId > 0, "Source championship ID is invalid.");
  assert(typeof data.source.publicUrl === "string" && data.source.publicUrl.startsWith("https://"), "Official source URL is invalid.");
  assert(data.championship && cleanText(data.championship.name), "Championship does not exist.");
  assert(Array.isArray(data.events) && data.events.length > 0, "Championship events are empty.");
  assert(Array.isArray(data.standings), "Championship standings must be an array.");
  validateDate(data.lastUpdated, "Last updated");

  const eventIds = new Set();
  const roundNumbers = new Set();
  let completedRounds = 0;

  data.events.forEach((event) => {
    assert(Number.isInteger(event.id) && event.id > 0, "Event ID is invalid.");
    assert(Number.isInteger(event.round) && event.round > 0, "Event round number is invalid.");
    assert(cleanText(event.name), "Event name is missing.");
    assert(!eventIds.has(event.id), "Duplicate event ID detected: " + event.id);
    assert(!roundNumbers.has(event.round), "Duplicate round detected: " + event.round);
    eventIds.add(event.id);
    roundNumbers.add(event.round);

    ["practiceStart", "practiceEnd", "startDate", "endDate"].forEach((field) => {
      validateDate(event[field], "Round " + event.round + " " + field);
    });

    assert(Date.parse(event.practiceStart) <= Date.parse(event.practiceEnd), "Practice dates are reversed for round " + event.round + ".");
    assert(Date.parse(event.startDate) <= Date.parse(event.endDate), "Competition dates are reversed for round " + event.round + ".");
    assert(VALID_EVENT_STATUSES.has(event.status), "Event status is invalid for round " + event.round + ".");
    if (event.status === "completed") completedRounds += 1;
  });

  assert(data.championship.totalRounds === data.events.length, "Championship round count does not match events.");
  assert(data.championship.completedRounds === completedRounds, "Completed round count does not match events.");
  if (completedRounds > 0) {
    assert(data.standings.length > 0, "Standings are empty despite completed rounds.");
    assert(data.latestResult && data.latestResult.podium.length > 0, "Latest completed round has no result.");
  }

  const driverIds = new Set();
  const driverNames = new Set();
  data.standings.forEach((standing) => {
    assert(Number.isInteger(standing.position) && standing.position > 0, "Driver position is invalid.");
    assert(cleanText(standing.driver), "Driver name is missing.");
    assert(Number.isFinite(standing.points) && standing.points >= 0, "Driver points are invalid for " + standing.driver + ".");
    assert(Number.isInteger(standing.eventsEntered) && standing.eventsEntered >= 0, "Events entered is invalid for " + standing.driver + ".");

    const nameKey = standing.driver.toLocaleLowerCase();
    assert(!driverNames.has(nameKey), "Duplicate driver detected: " + standing.driver);
    driverNames.add(nameKey);

    if (standing.id !== null) {
      assert(!driverIds.has(standing.id), "Duplicate driver ID detected: " + standing.id);
      driverIds.add(standing.id);
    }
  });

  if (data.latestResult) {
    validateDate(data.latestResult.date, "Latest result date");
    const podiumPositions = new Set();
    data.latestResult.podium.forEach((entry) => {
      assert([1, 2, 3].includes(entry.position), "Latest result podium position is invalid.");
      assert(cleanText(entry.driver), "Latest result driver is missing.");
      assert(!podiumPositions.has(entry.position), "Latest result contains duplicate podium positions.");
      podiumPositions.add(entry.position);
    });
  }

  if (data.upcomingEvent) {
    assert(data.upcomingEvent.status !== "completed", "Upcoming event is already completed.");
  }

  return data;
}

function withoutVolatileFields(value) {
  if (Array.isArray(value)) return value.map(withoutVolatileFields);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "lastUpdated")
        .map(([key, nested]) => [key, withoutVolatileFields(nested)])
    );
  }
  return value;
}

export function stablePayload(data) {
  return JSON.stringify(withoutVolatileFields(data));
}

export async function persistSnapshot(candidate, outputPath) {
  validateChampionshipData(candidate);

  let existing = null;
  try {
    existing = JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (existing && stablePayload(existing) === stablePayload(candidate)) {
    return { changed: false, outputPath };
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = outputPath + ".tmp";

  try {
    await writeFile(temporaryPath, JSON.stringify(candidate, null, 2) + "\n", "utf8");
    const verificationCopy = JSON.parse(await readFile(temporaryPath, "utf8"));
    validateChampionshipData(verificationCopy);
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  return { changed: true, outputPath };
}
