# Invariants

1. **All API endpoints require authentication** except `/auth/login`, `/auth/register`, and `/health`. No anonymous access to any other route.

2. **Database migrations must be backward-compatible.** Never drop columns or rename tables in a migration that will be deployed while the old code is still running. Use expand-contract pattern.

3. **P99 response time must stay below 200ms** for all CRUD endpoints. If a new feature pushes latency above this, it must be optimized or deferred.

4. **SQL queries must use parameterized placeholders.** No string concatenation or template literals for query values. This is a security invariant — no exceptions.

5. **Refresh tokens are single-use.** After a refresh token is consumed, it is immediately invalidated. Token reuse triggers revocation of the entire token family (potential theft detection).

6. **The `.env` file is never committed to git.** All secrets (DB password, JWT private key, API keys) come from environment variables.
