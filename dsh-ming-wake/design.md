# Reliability repair design

User-approved scope: wake, resume, browse, skill-isolate, bilibili-account only. No deployment, real network, ADB or session invocation. Existing frequencies and business rules remain unchanged.

Wake: serialize file mutations and tick admission, assign each arm a UUID, atomically replace JSON. Persist attempting before dispatch; success alone sets firedAt. An exception after invocation is unknown, not retryable: retain explicit unknown state for manual reconciliation/re-arm. A crash in attempting is also unknown on restart. Never promise exactly-once; single-process coordination does not protect external writers. Old completion must compare arm identity before touching disk.

Media: async bounded execFile, serialize physical-device operations, own pauses by exact event agent object and turn. An unrelated stopping event cannot restore. State-read failure is unknown, never treated as paused. Test only fake ADB.

Browse: reserve wake before first await and use a finally-released tick gate. Skill: retain every live provider control, drop on its AbortSignal and invalidate all. Bili: bound fetch plus body reads with abort/deadline and tool cancellation without retrying writes.

Contracts inspected: agents.resume accepts resumeSessionId and resolves AgentHandle; pre-step and turn-stopping payload carry agent, turn, signal; SkillProviderControl exposes signal and invalidate. No new inferred session fields.

# Plan
1. Back up only edited source files with exclusive copy (never overwrite).
2. Write isolated regression tests that fail against originals; run and record red.
3. Minimal fixes in the five plugin directories; run focused tests and node --check.
4. Review concurrency, errors, cleanup and unknown outcomes; report limitations and exact rollback to parent.

Implementation is sequential (delegation depth exhausted). Existing user approval covers this minimal design; broader behavioral changes are deferred.
