# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue or Discussion.

Use GitHub's private reporting: open the **Security** tab of this repository and choose
**Report a vulnerability** (https://github.com/ensemlabs/peep/security/advisories/new).

Include what you found, the steps to reproduce it, the version or commit, and the impact you expect. We aim to
acknowledge a report within a few days and to agree on a fix and disclosure timeline with you. Please give us a
reasonable time to fix the problem before you disclose it.

## Supported versions

Only the latest release and the `main` branch receive security fixes.

## Scope

Peep is meant to be self-hosted. Running it safely also depends on your setup: keep `.env` and `config/models.yaml`
private, use strong secrets, set `COOKIE_SECURE=true` and put it behind HTTPS. Weak configuration of your own
deployment is not a vulnerability in Peep. The built-in protections are listed in the Security section of the
[README](README.md#security).
