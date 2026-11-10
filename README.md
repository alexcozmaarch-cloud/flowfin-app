# FlowFin

Personal finance tracker on GitHub Pages with a Google Apps Script + Google Sheets backend (`backend/Code.gs`).
No build step: the browser loads the files as they are.

- `index.html`: page shell and icon sprite
- `css/app.css`: Swiss Grid styles
- `js/config.js`: settings and shared state (classic script, loaded first; plain globals)
- `js/main.js`: entry point (delegated events, boot); imports the sections below
- `js/core.js`: periods (10th → 9th) and the totals that must match Base44; no page code, tested on its own
- `js/api.js`: the backend (no Content-Type header on requests), `js/nav.js`: the single `draw()` dispatcher
- one file per page: `dashboard`, `transactions`, `budgets`, `goals` (+ `jobs`), `monthly`, `wealth`, `recurring`, `anomalies`, `settings`, `import`, `charts`

Pages never call each other's drawing code; they only share helpers.

The Sheet ID and access key are not stored in this repo: the Sheet ID lives in the Apps Script project, and the access key is entered in the app's Settings and kept in the browser.

## Tests

`tests/` holds automated checks that open the app in a headless browser with a fake backend and made-up data
(nothing real is ever committed: this repository is public). They cover the money maths for six finished periods,
every page on desktop and phone, and the add form on a phone. They run on every push (GitHub → Actions → Tests).

Run locally: `cd tests && npm install && npx playwright install chromium && node run.js`.
Set `FLOWFIN_DATA` to a folder with the Base44 CSV exports and `expected.json` to also compare against the real figures.
