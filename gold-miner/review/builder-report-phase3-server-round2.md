# Phase 3 server/deploy builder report, round 2 (claims to verify)

The Builder claims:

- **Tests:** `npm test` now runs 60/60 (up from 52). shellcheck is clean. index.html, tests/ and screenshots/ were not touched. `ACCEPT_VERSIONS` was NOT added.

## Fixes, as claimed
1. **Must-fix:** `RateLimiter.peek(key)` and `record(key)` were added. `handleAdmin` peeks first; a locked IP gets 429 plus `Retry-After` without the password ever being compared. Only failures are recorded.
   - New test: 14 wrong attempts give 10×401 then 4×429. After that, the correct password returns 429 for GET and DELETE, another IP is unaffected, the response is still 429 at +30 s, and it is 200 at +61 s.
2. **apt lock:** every apt-get call has `-o DPkg::Lock::Timeout=600`; DEPLOY.md §11 has a new FAQ entry, Q1b; there is a test for it.
3. **ufw:** `ufw allow OpenSSH`, plus every port detected from `sshd -T` (falling back to `ss -tlnp`, then 22), before enabling.
   - Tests use a stubbed sshd: one port, several ports, the `ss` fallback, and the default.
4. **Environment differences:**
   - a. `node_ok` accepts Node ≥ 22 outside /root or /home. The resolved path goes into the unit, the cron entry and the wrapper; `update.sh` reuses `ExecStart`.
   - b. The `listen [::]` line is removed unless /proc/net/if_inet6 exists; `GOLDMINER_INET6_FILE` overrides the path for testing.
   - Both were tested by dry-run and stubs only.
5. **Rate limiter:** a sweep at most every 30 s, and a 50k-key LRU cap. With 200k keys, a check takes 17.99 µs, keys stay capped at 50k, and the heap grows about 14.5 MB.
6. **Slow requests:** `connectionsCheckingInterval` is 2000, so a stalled body or header gets 408 at about 10.0 s.
7. **Client:**
   - a. `LB_ACCEPT_VERSION = 2`; `lbSubmit` with any other version resolves `bad_version` with no request; new `lbShouldOffer`; new test.
   - b. INTEGRATION.md has a "手机 / mobile" subsection.

## Changed assertions
- `client.test.js`: `lbSubmit(undefined)` now expects the local `bad_version` error.
- D-02: the expected apt line now includes the lock-timeout option.

## Bug found and fixed
`update.sh --dry-run` exited 2 when no unit file was installed, because `grep` failed under pipefail. Fixed with `|| true`.

## Known issues, as stated
- The `ss` fallback was only tested against a stub line format.
- Node installs under a home directory (e.g. nvm) are ignored, and NodeSource installs a system Node instead.
- Evicted IPs lose their rate-limit counters.
