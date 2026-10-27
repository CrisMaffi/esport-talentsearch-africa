import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_SOURCE_BYTES = 5_000_000;
const MAX_SOURCE_REDIRECTS = 3;
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

// SvelteKit answers a moved page's __data.json with HTTP 200 and a
// {"type":"redirect","location":"/new/path?query"} payload instead of an HTTP
// redirect. The provider moved its routes in October 2026 (/schedule ->
// /championships/{id}/calendar, etc.), which broke the sync. Following these
// payloads (same origin only, bounded hops) keeps future route moves from
// breaking the job, while the endpoints below point at the current routes.
export function svelteDataUrlForLocation(currentUrl, location) {
  const current = new URL(currentUrl);
  const target = new URL(String(location), current);
  assert(target.origin === current.origin, "Source redirected to a different origin: " + target.origin);
  const pagePath = target.pathname.replace(/\/__data\.json$/, "").replace(/\/+$/, "");
  target.pathname = (pagePath || "") + "/__data.json";
  return target.toString();
}

export async function fetchSveltePageData(url, fetchImpl = fetch) {
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_SOURCE_REDIRECTS; hop += 1) {
    const payload = await fetchSveltePayload(currentUrl, fetchImpl);
    if (payload && payload.type === "redirect" && typeof payload.location === "string") {
      currentUrl = svelteDataUrlForLocation(currentUrl, payload.location);
      continue;
    }

    assert(
      payload && payload.type === "data" && Array.isArray(payload.nodes),
      "Unexpected source schema for " + currentUrl + " (payload type: " + (payload && payload.type) + ")."
    );

    return payload.nodes
      .filter((node) => node && node.type === "data" && Array.isArray(node.data))
      .map((node) => decodeSvelteData(node.data));
  }

  throw new Error("Source redirected more than " + MAX_SOURCE_REDIRECTS + " times starting from " + url);
}

async function fetchSveltePayload(url, fetchImpl) {
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

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Source returned malformed JSON for " + url);
  }
}

export function sourceEndpoints(baseUrl, championshipId, roundId = null) {
  const base = new URL(baseUrl);
  const id = Number(championshipId);
  assert(Number.isInteger(id) && id > 0, "Championship ID must be a positive integer.");

  const endpoints = {
    schedule: trustedUrl(base, "/championships/" + id + "/calendar/__data.json", {}),
    standings: trustedUrl(base, "/championships/" + id + "/standings/__data.json", {})
  };

  if (roundId !== null) {
    endpoints.latestResult = trustedUrl(base, "/championships/" + id + "/__data.json", {
      round: roundId,
      week: "time_attack"
    });
  }

  return endpoints;
}

export function publicPageUrls(baseUrl, championshipId) {
  const base = new URL(baseUrl);
  const id = Number(championshipId);
  return {
    calendar: trustedUrl(base, "/championships/" + id + "/calendar", {}),
    result: (roundId, format) => trustedUrl(base, "/championships/" + id, format === "race"
      ? { round: roundId }
      : { round: roundId, week: "time_attack" })
  };
}

// The provider has used two shapes for championship metadata:
//   legacy:  { title, selectedChampId, championships: [{ id, name }] }
//   current: { champ: { id, name, game }, roundCount, ... }
function championshipIdentity(metadata) {
  if (metadata && metadata.champ && typeof metadata.champ === "object") {
    return { id: finiteNumber(metadata.champ.id), name: cleanText(metadata.champ.name) };
  }
  const selected = (metadata.championships || []).find(
    (item) => Number(item.id) === Number(metadata.selectedChampId)
  );
  return {
    id: finiteNumber(metadata.selectedChampId),
    name: cleanText(selected && selected.name) || cleanText(metadata.title)
  };
}

export function selectSourceRecords(scheduleNodes, standingsNodes, resultNodes = []) {
  const metadata = scheduleNodes.find(
    (node) => node && (
      (node.champ && typeof node.champ === "object" && node.champ.id !== undefined) ||
      (node.title && Array.isArray(node.championships))
    )
  );
  const schedule = scheduleNodes.find(
    (node) => node && Array.isArray(node.rounds) && node.rounds.some((round) => round.practice_start)
  );
  const standings = standingsNodes.find(
    (node) => node && Array.isArray(node.standings) && Array.isArray(node.rounds)
  );
  const result = resultNodes.find(
    (node) => node && node.round && (Array.isArray(node.board) || (node.race && Array.isArray(node.race.rows)))
  ) || null;

  assert(metadata, "Championship metadata is missing from the schedule source.");
  assert(schedule, "Championship rounds are missing from the schedule source.");
  assert(standings, "Driver standings are missing from the standings source.");

  return { metadata, schedule, standings, result };
}

function normalizeEvent(round, pages, timezone, referenceTime) {
    const rawStatus = cleanText(round.status) || "unknown";
    let status = "upcoming";
    const practiceStart = isoOrNull(round.practice_start, timezone);
    const endDate = isoOrNull(round.ta_end, timezone);

    if (round.completed || ["closed", "completed", "final"].includes(rawStatus.toLowerCase())) {
      status = "completed";
    } else if (["live", "active", "open", "running", "practice", "time_attack", "race"].includes(rawStatus.toLowerCase())) {
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

  const format = cleanText(round.format) || "time_attack";
  const resultUrl = status === "completed" ? pages.result(round.id, format) : null;

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
    format,
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

function normalizePodium(result, standingsRows) {
  if (!result) return [];
  if (Array.isArray(result.board) && result.board.length > 0) {
    return normalizeBoardPodium(result.board);
  }
  if (result.race && Array.isArray(result.race.rows)) {
    return normalizeRacePodium(result.race.rows, standingsRows);
  }
  return [];
}

// Race-format rounds (introduced for F4 in October 2026) publish a finishing
// order in race.rows instead of a time-attack board. emsa_position is the
// classification used for EMSA points; driver nationality/number come from
// the standings because race rows only carry the driver's name and id.
function normalizeRacePodium(rows, standingsRows) {
  const drivers = new Map(
    (standingsRows || []).map((row) => [finiteNumber(row.driverId), row.driver || {}])
  );
  return rows
    .map((row) => ({ row, position: finiteNumber(row.emsa_position, finiteNumber(row.position)) }))
    .filter(({ row, position }) =>
      Number.isInteger(position) && position >= 1 && position <= 3 &&
      String(row.status || "finished").toLowerCase() === "finished")
    .sort((a, b) => a.position - b.position)
    .map(({ row, position }) => {
      const driver = drivers.get(finiteNumber(row.driver_id)) || {};
      return {
        position,
        driver: cleanText(row.driver_name) || cleanText(driver.name),
        country: cleanText(driver.nationality),
        racingNumber: finiteNumber(driver.racing_number),
        timeMs: finiteNumber(row.total_time_ms)
      };
    });
}

function normalizeBoardPodium(board) {
  return [...board]
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
  const { metadata, schedule, standings, result } = source;

  const identity = championshipIdentity(metadata);
  assert(
    identity.id === championshipId,
    "The source returned a different championship than requested."
  );

  const championshipName = identity.name;
  const pages = publicPageUrls(baseUrl, championshipId);
  const publicUrl = pages.calendar;
  const timezone = cleanText(schedule.timezone) || "Africa/Addis_Ababa";
  const lastUpdated = options.lastUpdated || new Date().toISOString();
  const referenceTime = Date.parse(lastUpdated);
  const events = schedule.rounds
    .filter((round) => Number(round.championship_id) === championshipId)
    .map((round) => normalizeEvent(round, pages, timezone, referenceTime))
    .sort((a, b) => a.round - b.round);
  const completedEvents = events.filter((event) => event.status === "completed");
  const pendingEvents = events.filter((event) => event.status !== "completed");
  const latestEvent = completedEvents.at(-1) || null;
  const upcomingEvent = pendingEvents
    .sort((a, b) => Date.parse(a.practiceStart) - Date.parse(b.practiceStart))[0] || null;
  const normalizedStandings = standings.standings
    .map(normalizeStanding)
    .sort((a, b) => a.position - b.position);
  const podium = normalizePodium(result, standings.standings);

  if (latestEvent) {
    assert(result && Number(result.round.id) === latestEvent.id, "Latest result does not match the latest completed round.");
  }

  const latestResult = latestEvent
    ? {
        round: latestEvent.round,
        eventName: latestEvent.name,
        date: latestEvent.endDate,
        track: latestEvent.track,
        format: latestEvent.format,
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
  const completedEvents = [];

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
    if (event.status === "completed") completedEvents.push(event);
  });

  assert(data.championship.totalRounds === data.events.length, "Championship round count does not match events.");
  assert(data.championship.completedRounds === completedEvents.length, "Completed round count does not match events.");

  // A completed round with a zero points multiplier (a shakedown/test round,
  // e.g. Championship 2's Okayama "Test" round) legitimately awards no
  // championship points and may carry no competitive result at all, so it
  // must not be held to the same result/standings requirements as a scored
  // round. "Latest" mirrors normalizeChampionship's own latestEvent pick:
  // the completed round with the highest round number, not just any of them.
  if (completedEvents.length > 0) {
    const latestCompleted = completedEvents.reduce((a, b) => (b.round > a.round ? b : a));
    if (Number(latestCompleted.pointsMultiplier) > 0) {
      assert(data.latestResult && data.latestResult.podium.length > 0, "Latest completed round has no result.");
    }
  }
  if (completedEvents.some((event) => Number(event.pointsMultiplier) > 0)) {
    assert(data.standings.length > 0, "Standings are empty despite completed scored rounds.");
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
