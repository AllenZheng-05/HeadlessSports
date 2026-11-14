# Memory soak

Plays rounds back to back with the synthetic player while sampling memory. Full write-up and
latest results: `docs/SOAK.md`.

    pnpm test:soak                       # builds dist-soak, serves it on port 4230, runs 8 scenarios
    SOAK_MINUTES=1 pnpm test:soak        # quick shake-out (about 10 minutes in total)

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SOAK_MINUTES` | 4 | Minutes per scenario (the rotation may run up to twice that to finish two cycles) |
| `SOAK_TIMESCALE` | 2 | `timeScale` for the synthetic sources (game clock speed) |
| `SOAK_MAX_HEAP_MB_PER_MIN` | 8 | A JS heap slope (after discarding the first 20% of samples) above this fails the test |

Output (ignored by git): `e2e-soak/results/<scenario>.json` (raw samples) and
`e2e-soak/results/summary.md` (tables). The production CSP applies, so the spec only passes real
functions to `page.evaluate`.
