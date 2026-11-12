# Hosted website verification

Prepared November 12, 2026. No public deployment URL has yet been confirmed.

## Passed

- **10 hosted backend tests**, 4.795 seconds on the development Windows environment.
  Actual default-model output equals the direct engine. Tests also cover NPZ
  round trips of every numerical array, cookie/origin validation, per-session
  result ownership, quota preservation, expiry/rotation, work limits, busy
  responses, malformed input and source changes during a calculation.
- **6 focused browser checks**, using one actual simulation. Local recovery remains
  intact; hosted missing-module/startup errors show web-specific help. Busy,
  non-JSON and network errors preserve the completed result/playback and enable
  manual retry. No unexpected page errors or external page requests occurred.
- The preceding neuron-label changes passed **6 layouts** with no annotation
  overlap/clipping or unintended reruns.

## Not yet verified

- Linux Docker/Gunicorn build and live Render HTTPS deployment.
- Deployed default/drug/control numerical equivalence and native browser downloads.
- Performance at the intended classroom size.

The local ten-client real-HTTP QA attempt was blocked by automatic execution review
because the host attempted an external Visual Studio telemetry connection with an
unspecified payload. It produced no completed report, was not retried indirectly,
and is not counted as a passing test. The owned tool session was unavailable when
termination was requested, so that attempt's server shutdown was not independently
confirmed. Docker's local Linux engine and browser automation connection were also
unavailable. These limits do not establish defects in the scientific engine, but
they prevent claiming a complete live-site verification.

The initial free hosting configuration is a pilot. The deployment and an actual
classroom-device rehearsal must pass before treating it as classroom-ready.
