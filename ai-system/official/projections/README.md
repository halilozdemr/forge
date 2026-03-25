# Official Projection Profiles

Projection profiles are capability overlays, not standalone agents.

Rules:
- Intake-first is mandatory. Projections cannot bypass `intake-gate`.
- Projections do not run directly as official execution.
- Projections do not orchestrate, dispatch, assign, or create tasks.
- Projections only constrain or focus `builder` execution behavior.
- Official pipeline remains authoritative.

Supported minimal official projection profiles:
- `frontend-ui`
- `backend-api`
- `debugging`
- `refactor-safe`
