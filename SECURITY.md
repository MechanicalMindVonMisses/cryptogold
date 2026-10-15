# Security policy

## Reporting a vulnerability

Please report security problems **privately**, not in public issues:

**[Report a vulnerability](https://github.com/MechanicalMindVonMisses/cryptogold/security/advisories/new)**
(GitHub private vulnerability reporting; only the maintainer can see it).

Helpful details: what you found, where (URL or file), steps to reproduce, and the impact you expect. You'll get a
reply through the same report. The live site also publishes this contact at
[/.well-known/security.txt](https://www.cryptogold.me/.well-known/security.txt).

## Scope

In scope:

- The live site, [www.cryptogold.me](https://www.cryptogold.me), and its `/api/*` endpoints
- The code in this repository, including the Windows deployment scripts in `deploy/windows/`

Out of scope:

- The third-party services AuRatio uses (FreeCryptoAPI, CoinGecko, XAUS, Binance, Cloudflare): please report
  problems with those to them directly.
- Denial-of-service or load testing. The site runs on a single home PC, and automated traffic is challenged by
  Cloudflare's bot protection.

## Supported versions

Only the latest code on the `main` branch, which is what the live site runs, receives fixes.
