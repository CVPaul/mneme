# Pitfalls

1. **Express 5 does not catch async errors by default.** If an async route handler throws, Express will not call the error-handling middleware — the request hangs until timeout. Every async handler must either use `express-async-errors` or wrap in try/catch. We use the wrapper pattern in `src/middleware/asyncHandler.js`.

2. **`pg` returns all values as strings by default.** Integer columns come back as `"42"`, not `42`. Use `pg-types` to register custom parsers for `INT4`, `INT8`, `NUMERIC`, and `TIMESTAMP` types. Configured in `src/db/type-parsers.js`.

3. **PostgreSQL timestamps are stored in UTC but displayed in server timezone.** Always use `TIMESTAMPTZ` (not `TIMESTAMP`), and always pass ISO 8601 strings with explicit timezone to the client. The `AT TIME ZONE` clause is needed for any user-facing date display.

4. **JWT RS256 keys must be in PEM format, not JWK.** The `jsonwebtoken` library rejects JWK-formatted keys silently — it returns `null` instead of throwing. Discovered after 2 hours of debugging in session 7.

5. **Node.js `fetch` does not reject on HTTP error status codes.** `fetch("/api/foo")` resolves successfully even on 404 or 500. Always check `response.ok` before parsing the body. This bit us in integration tests that appeared to pass but were testing error responses.
