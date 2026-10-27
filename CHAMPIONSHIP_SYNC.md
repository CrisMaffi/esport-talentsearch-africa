# ETSA Championship Synchronization

## Purpose

The ETSA public website displays validated snapshots of the current Ethiopian
sim-racing championships.

- Public ETSA page: championship.html
- Rally snapshot: data/championship.json
- F4 snapshot: data/championship-f4.json
- Rally page: https://simracing.ethiopianmotorsport.com/championships/1/calendar
- F4 page: https://simracing.ethiopianmotorsport.com/championships/2/calendar
- Configuration: config/championships.json

The browser never parses the remote website. It only reads the local verified
JSON snapshot deployed with ETSA.

## Structured source discovered

The Ethiopian Motorsport platform is a server-rendered SvelteKit application.
It exposes structured SvelteKit data responses used by the official pages:

| Purpose | Endpoint |
|---|---|
| Championship metadata and rounds | https://simracing.ethiopianmotorsport.com/championships/{championshipId}/calendar/__data.json |
| Driver standings and round points | https://simracing.ethiopianmotorsport.com/championships/{championshipId}/standings/__data.json |
| Latest round result | https://simracing.ethiopianmotorsport.com/championships/{championshipId}/__data.json?round={roundId}&week=time_attack |

These routes changed on about 2026-10-20 (previously `/schedule/__data.json?champ=…`,
`/standings/__data.json?champ=…` and `/__data.json?champ=…&round=…`). The old
routes now answer with a SvelteKit redirect payload
(`{"type":"redirect","location":"…"}`). The sync follows such payloads
automatically (same origin only, at most 3 hops), so a future route move does
not stop the job; update the endpoints here when that happens.

The championship metadata node is accepted in both the current shape
(`champ: {id, name}`) and the legacy shape (`title`, `selectedChampId`,
`championships`).

The sync decodes the SvelteKit flattened data format. It does not parse remote
DOM markup.

Fields used:

- Championship: selected ID, name and available championships
- Schedule: round ID/number/title, track, country, surface, length, notes, car,
  practice dates, Time Attack dates, source status, completion flag and points
  multiplier
- Standings: driver ID/name/nationality/racing number, rank, total points and
  per-round result details
- Latest result: for Time Attack rounds, the `board` (rank, driver,
  nationality and official time); for race-format rounds (`format: "race"`),
  the `race.rows` finishing order using `emsa_position`, finishers only, with
  nationality and racing number joined from the standings. Race podiums may have
  no time; the page then shows positions only.

The source does not currently expose team names, so ETSA does not display them.

## Normalized schema

Each championship snapshot contains:

- schemaVersion
- source: provider, championship ID, official public URL and structured endpoints
- championship: name, season, timezone, round counts, leader, latest round and next round
- standings[]: position, driver, country, racing number, points, derived wins,
  derived podiums and events entered
- events[]: round, name, track, country, dates, surface, car, status, points
  multiplier and official result link where available
- latestResult: latest event, winner and podium
- upcomingEvent
- lastUpdated

Wins, podiums and events entered are deterministic counts from the source
round-by-round result details.

## Automatic update

Workflow: .github/workflows/sync-championship.yml

- Scheduled daily at 06:00 UTC
- Supports workflow_dispatch
- Runs unit and failure-protection tests
- Fetches all enabled championships, each independently: one failing
  championship does not block updates to the others, but the job still fails
- Validates the normalized candidate
- Writes through a temporary file
- Commits only changed data/*.json files
- Pushes the verified snapshot to the current branch

On the default branch, that commit enters the existing GitHub to Cloudflare Pages
deployment path. The workflow does not change Cloudflare, DNS or Netlify.

## Manual refresh

In GitHub:

1. Open Actions.
2. Select Sync live championship.
3. Choose Run workflow.
4. Leave the championship ID blank to refresh Rally and F4, or enter `1` or `2` for one championship.
5. Run the workflow.

Local refresh:

    npm run championship:sync
    npm run championship:validate

## Failure handling

Each candidate is validated before replacing its current snapshot.

The sync fails without replacing the current file when:

- the source cannot be reached or does not return JSON;
- the source schema changes unexpectedly;
- the requested championship does not exist;
- completed rounds have no standings or latest result;
- points or dates are invalid;
- duplicate drivers, event IDs or round numbers are detected.

The GitHub Action exits with an error and creates no commit for the failed
championship. Cloudflare continues serving the last verified snapshot.

The failure reason is posted as an error annotation on the workflow run page
(Actions → the failed run → Annotations), so it can be read without opening the
job log. GitHub emails the repository owner when a scheduled run fails.

The Checks workflow (.github/workflows/checks.yml) runs `npm run check` on every
push and pull request, so parser changes are tested before they reach the daily
sync.

## Validation and local checks

    npm test
    npm run championship:validate
    npm run check

The tests cover decoding, normalization, latest/upcoming logic, duplicate
rejection, last-good-file preservation and no-change detection.
tests/source-2026-10.test.mjs replays real provider responses captured on
2026-10-27 (tests/fixtures/source-2026-10): new routes, redirects from the old
routes, the new metadata shape and a race-format result. When the provider
changes again, capture fresh responses into a new fixtures folder and add a
test alongside.

## Changing or adding a championship

The source and output are configuration-driven in config/championships.json.
Each entry has:

- id: source championship ID
- enabled: whether daily sync processes it
- public: reserved for public-site selection
- output: independent normalized JSON destination

To add another approved championship, add a separate entry with a separate
output file. Do not point two IDs at the same output file. Public navigation can
then consume the additional snapshot without changing the source integration.

For a one-off local run, CHAMPIONSHIP_ID can restrict the sync to an already
configured championship. CHAMPIONSHIP_SOURCE_BASE, CHAMPIONSHIP_CONFIG_PATH,
and CHAMPIONSHIP_DATA_PATH are available for controlled testing.

Only public championships are configured.
