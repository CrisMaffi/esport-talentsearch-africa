# ETSA Championship Synchronization

## Purpose

The ETSA public website displays a validated snapshot of the current Ethiopian
sim-racing championship. Ethiopian Motorsport remains the authoritative timing,
results and schedule system.

- Public ETSA page: championship.html
- Normalized snapshot: data/championship.json
- Official source: https://simracing.ethiopianmotorsport.com/schedule?champ=1
- Configuration: config/championships.json

The browser never parses the remote website. It only reads the local verified
JSON snapshot deployed with ETSA.

## Structured source discovered

The Ethiopian Motorsport platform is a server-rendered SvelteKit application.
It exposes structured SvelteKit data responses used by the official pages:

| Purpose | Endpoint |
|---|---|
| Championship metadata and rounds | https://simracing.ethiopianmotorsport.com/schedule/__data.json?champ=1 |
| Driver standings and round points | https://simracing.ethiopianmotorsport.com/standings/__data.json?champ=1 |
| Latest round result | https://simracing.ethiopianmotorsport.com/__data.json?champ=1&round={roundId}&week=time_attack |

The sync decodes the SvelteKit flattened data format. It does not parse remote
DOM markup.

Fields used:

- Championship: selected ID, name and available championships
- Schedule: round ID/number/title, track, country, surface, length, notes, car,
  practice dates, Time Attack dates, source status, completion flag and points
  multiplier
- Standings: driver ID/name/nationality/racing number, rank, total points and
  per-round result details
- Latest result: rank, driver, nationality and official time

The source does not currently expose team names, so ETSA does not display them.

## Normalized schema

data/championship.json contains:

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
- Fetches all enabled championships
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
4. Keep championship ID 1.
5. Run the workflow.

Local refresh:

    npm run championship:sync
    npm run championship:validate

## Failure handling

The candidate is validated before replacing data/championship.json.

The sync fails without replacing the current file when:

- the source cannot be reached or does not return JSON;
- the source schema changes unexpectedly;
- the requested championship does not exist;
- completed rounds have no standings or latest result;
- points or dates are invalid;
- duplicate drivers, event IDs or round numbers are detected.

The GitHub Action exits with an error and creates no data commit. Cloudflare
continues serving the last verified snapshot.

## Validation and local checks

    npm test
    npm run championship:validate
    npm run check

The tests cover decoding, normalization, latest/upcoming logic, duplicate
rejection, last-good-file preservation and no-change detection.

## Changing or adding a championship

The source and output are configuration-driven in config/championships.json.
Each entry has:

- id: source championship ID
- enabled: whether daily sync processes it
- public: reserved for public-site selection
- output: independent normalized JSON destination

To add a future approved championship, add a separate entry with a separate
output file, for example data/championship-2.json. Do not point two IDs at the
same output file. Public navigation or a championship selector can then consume
the additional snapshot without changing the source integration.

For a one-off local run, CHAMPIONSHIP_ID can restrict the sync to an already
configured championship. CHAMPIONSHIP_SOURCE_BASE, CHAMPIONSHIP_CONFIG_PATH,
and CHAMPIONSHIP_DATA_PATH are available for controlled testing.

No confidential or unapproved future championship is configured.
