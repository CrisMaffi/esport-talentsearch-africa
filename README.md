# Esport Talent Search Africa (ETSA)

Public website for ETSA by Maffi Esports — https://esport-talentsearch.africa

Static HTML/CSS/JS, deployed to Cloudflare Pages from the `main` branch.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Home |
| `events.html` | Events |
| `digital-grand-prix.html` | Digital Grand Prix programme and interest form (email-based) |
| `championship.html` | Live Rally and F4 championship standings |
| `contact.html` | Contact and team |

Shared assets live in `assets/`; championship snapshots in `data/`.

## Live championship data

`data/championship.json` (Rally) and `data/championship-f4.json` (F4) are
refreshed daily from the official Ethiopian Motorsport platform by the
**Sync live championship** workflow. See [CHAMPIONSHIP_SYNC.md](CHAMPIONSHIP_SYNC.md)
for sources, schema, failure handling and manual refresh.

## Checks

    npm test                       # unit and regression tests
    npm run championship:validate  # validate committed snapshots
    npm run check                  # everything above + static site checks

The **Checks** workflow runs `npm run check` on every push and pull request.

## Workflow conventions

- Work on a branch and open a pull request; merge once Checks pass.
- Delete the branch after merging (or enable *Settings → General →
  Automatically delete head branches*).
