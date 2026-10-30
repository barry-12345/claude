# Phase 3 server/deploy builder report, round 1 (claims to verify)

The Builder claims:

- **Tests:** `cd /home/user/gold-miner/server && npm test` passes 52 tests, 0 failing, in about 11 s. index.html, tests/ and screenshots/ were not touched.
- **Database:** better-sqlite3 13.0.3, on Node 22.22.

## Layout
- **Server code:**
  - `server/src/`: `server.js` (node:http router), `db.js` (WAL, `PRAGMA user_version` migrations, submit transaction), `validate.js`, `ratelimit.js`, `config.js`, `admin-ops.js`;
  - `server/admin.js` (admin CLI), `server/scripts/backup.js`, `server/migrations/001_init.sql`, `server/badwords.txt` (97 entries), `server/README.md`.
- **Client:** `server/client/leaderboard-client.js` and `INTEGRATION.md`.
- **Tests:** `server/test/` with `api`, `ratelimit`, `admin`, `backup`, `deploy` and `client` tests, plus `helpers.js` and `page/lb-test.html`.
- **Deploy:** `/home/user/gold-miner/deploy/` (not `server/deploy/`, as the spec said) contains `deploy.sh` (`--domain` / `--email` / `--dry-run`), `update.sh`, `nginx.conf.tpl`, `goldminer.service`, `goldminer-backup.cron` and `DEPLOY.md` (11 sections). `deploy.sh` also installs a `/usr/local/bin/goldminer-admin` wrapper.
- **Extras beyond the spec:** entries carry an `id`; `/etc/goldminer.env` has `SITE_DOMAIN`.

## Client module
- **API base:** `lbBase()` uses `?api=`, then `window.GOLDMINER_API`, then same-origin. On `file://` it returns null, meaning unavailable.
- **Qualification check:** `lbQualifies` uses the last fetched list and returns `{known, qualifies, rank, cutoff}`.
- **Errors:** all functions resolve and never throw. Failures resolve to `{ok:false, unavailable:true, message:'暂时无法连接排行榜'}`. The default timeout is 4 s.

## Claimed results
- **S-01:** correct ordering; p95 2.72 ms over 100 GETs.
- **S-02:** 27 invalid-input cases rejected with the right codes; 413 / bad_json / 415.
- **S-03:** top-20 boundary and ties correct.
- **S-04:** 300 random submissions match a reference implementation.
- **S-05:** 50 concurrent POSTs give 24 written and 26 not_qualified; a multi-process test is consistent.
- **S-06:** pruning keeps exactly 100.
- **S-07:** rate limits of 5/min and 30/h, with `Retry-After`; GET is limited to 120/min; `TRUST_PROXY` handled.
- **S-08:** admin auth gives 404/401/429; delete, rename, archive and clear work through both the API and the CLI.
- **S-09:** backups taken while writes continue have intact integrity; 30-day retention; OFFSITE_CMD works; restore works.
- **S-10:** restart persistence; WAL mode; SIGTERM handled.
- **S-11:** injection-like names are stored verbatim; 500 responses show no stack trace; Content-Type is correct.
- **D-01:** `bash -n` and shellcheck are clean.
- **D-02:** the dry-run step order is correct, with Chinese usage text on bad arguments.
- **D-03:** `nginx -t` passes, after the test strips `listen [::]:80` because the sandbox has no IPv6.
- **D-04:** `systemd-analyze verify` passes.
- **D-05:** DEPLOY.md has 11 sections.
- **Client tests:** run in Node and Chromium, covering same-origin, `?api=`, CORS, unreachable, timeout, 500/HTML and `file://`, with 0 errors.
- **Deferred:** F-01 to F-11 (need index.html UI); INTEGRATION.md lists what to build.

## Known issues (stated)
- deploy.sh has not been run for real; there is no VPS, network or DNS here.
- The in-process race test is serialized, so the multi-process test is the real concurrency check.
- The timeout assertions are loose.
- The server accepts version 1–1000, so the front end must skip rules-1 results.
- Tie ordering assumes the clock moves forward.
- Backup file names use UTC.
- The bad-word list is conservative; short entries were removed.
- `SERVE_STATIC` is for dev only.
