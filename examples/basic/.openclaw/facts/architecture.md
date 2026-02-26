# Architecture

1. **Runtime**: Node.js 20 LTS with ES modules (`"type": "module"` in package.json)

2. **API framework**: Express 5 with the native JSON body parser. No additional middleware frameworks.

3. **Database**: PostgreSQL 16. All queries go through `pg` (node-postgres) with a connection pool (`max: 20`). No ORM — raw SQL with parameterized queries.

4. **Authentication**: JWT with RS256 signing. Access tokens expire in 15 minutes, refresh tokens in 7 days. Tokens are issued by `/auth/login` and `/auth/refresh`.

5. **API design**: RESTful, JSON-only. All endpoints return `{ data, error, meta }` envelope. Pagination uses cursor-based approach (`?cursor=<id>&limit=20`).

6. **Validation**: Zod schemas at the controller layer. Every request body and query parameter is validated before reaching the service layer.

7. **Error handling**: Centralized error handler middleware. Domain errors extend a base `AppError` class with HTTP status codes. Unhandled rejections return 500 with a request ID for tracing.

8. **Deployment**: Docker container behind nginx reverse proxy. Single Dockerfile with multi-stage build (builder + runtime). Environment config via `.env` file, never committed.

9. **Testing**: Vitest for unit and integration tests. Integration tests use a dedicated `todo_api_test` database that is reset before each test suite.
