# Pitfalls — Known Traps and Lessons

## Agent Behavior Pitfalls

1. **Re-analyzing already-confirmed conclusions**
   - Symptom: Agent re-analyzes architecture decisions in a new session, potentially overturning prior conclusions
   - Cause: Did not read OpenClaw facts, or did not give them sufficient priority after reading
   - Fix: Force facts reading at session start; make facts priority explicit in the prompt

2. **Recovering state from conversation history**
   - Symptom: Agent tries to reconstruct task progress from earlier conversation turns
   - Cause: Not using Beads; relying on information within the context window
   - Fix: Prohibit state recovery from conversation history; always read from Beads

3. **Trying to do too much in one session**
   - Symptom: Agent advances multiple tasks simultaneously, causing rapid context bloat
   - Cause: Not following the single-focus principle
   - Fix: Each session picks exactly one bead as focus

## Information Management Pitfalls

4. **Writing temporary conclusions to OpenClaw**
   - Symptom: Unverified hypotheses get written to facts; future sessions treat them as confirmed
   - Cause: Blurred boundary between "speculation" and "fact"
   - Fix: OpenClaw only accepts verified information; writing requires human approval

5. **Beads task granularity gets out of control**
   - Symptom: A single bead is too large (e.g. "complete the entire module"), making accurate progress tracking impossible
   - Cause: Insufficient task decomposition
   - Fix: A bead should be completable within 1–3 sessions

6. **Forgetting to persist before compaction**
   - Symptom: Key conclusions lost after context compaction; next session must re-derive them
   - Cause: Did not perform the pre-compaction persistence routine
   - Fix: When context approaches its limit, proactively run the persistence workflow

## Architecture Evolution Pitfalls

7. **Facts files growing without bounds**
   - Symptom: Facts files become increasingly long, raising read overhead
   - Cause: Only adding, never removing; no periodic review
   - Fix: Periodically review facts files; mark outdated content for deletion or archiving

8. **Duplicate information in Beads and facts**
   - Symptom: The same information exists in both Beads notes and OpenClaw facts
   - Cause: Unclear boundary between "what to do" and "what is"
   - Fix: Clear division — OpenClaw stores facts, Beads stores progress
