# Performance Rules

## Context Management Efficiency

1. **Minimize session startup overhead**
   - Ledger facts files should stay concise; total size should remain manageable
   - Each facts file should be no more than 200 lines
   - Total across all facts files should be no more than 800 lines
   - Goal: token cost of reading all facts at session start stays under control

2. **Beads data should be cleaned up periodically**
   - Completed beads with no remaining reference value can be archived
   - Active bead count should stay below 20
   - Too many beads increases the read overhead at each session start

3. **Information density over thoroughness**
   - Facts files should use concise, structured phrasing
   - Avoid lengthy explanatory text
   - A single fact should be expressible in 1–3 lines

## Compaction Efficiency

4. **Proactively manage compaction cadence**
   - Do not wait until context overflows to act
   - After completing a milestone, proactively persist state
   - Once persistence is done, allow compaction to free context space

5. **Conclusion extraction should be structured**
   - Use concise bullet points when writing to Beads notes
   - Avoid copying large blocks of code or logs into notes
   - Record only key decisions and conclusions, not the derivation process

## Inter-Layer Communication Efficiency

6. **Reduce unnecessary cross-layer reads and writes**
   - Do not refresh Beads after every operation (batch updates over frequent updates)
   - Ledger is read once at session start — no repeated reads
   - Only update Beads status when there is substantive progress

7. **Avoid duplicate information storage**
   - The same piece of information should not appear in both Ledger and Beads
   - Ledger stores "what is" — Beads stores "what to do / how far along"
   - If a conclusion appears repeatedly in Beads notes, consider promoting it to an Ledger fact
