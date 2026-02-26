# Performance Rules

1. **Batch inserts over 500 rows must use `COPY` or chunked transactions.** Inserting 500+ rows in a single `INSERT ... VALUES` exhausts the connection pool under concurrent load. Discovered in session 12 when bulk-import endpoint timed out.

2. **Always use `SELECT ... FOR UPDATE SKIP LOCKED` for task queue polling.** Row-level locking without `SKIP LOCKED` caused convoy effects when multiple workers polled the same table. Throughput dropped 80%.

3. **Paginate with cursors, not offsets.** `OFFSET` scans and discards rows, making deep pages O(n). Cursor-based pagination is O(1) for all pages.

4. **Connection pool size must match `max_connections / expected_instances`.** With 4 instances and `max_connections = 100`, each pool gets `max: 20`. Exceeding this causes connection wait timeouts.

5. **Cache user permissions in memory for the duration of a request.** A single request can check permissions 5-10 times. Fetching from DB each time adds 20-30ms.
