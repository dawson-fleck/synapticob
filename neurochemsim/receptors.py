"""Two-state open-fraction approximation; availability is applied elsewhere."""
from __future__ import annotations

import math


def advance_occupancy(occupancy: float, concentration_uM: float, dt_ms: float,
                      kon_uM_ms: float, koff_per_ms: float) -> float:
    """Exact constant-concentration update, bounded without post-hoc clipping."""
    values = (occupancy, concentration_uM, dt_ms, kon_uM_ms, koff_per_ms)
    if not all(math.isfinite(v) for v in values):
        raise ValueError("Receptor arguments must be finite.")
    if not 0 <= occupancy <= 1:
        raise ValueError("Receptor occupancy must be between zero and one.")
    if min(concentration_uM, dt_ms, kon_uM_ms, koff_per_ms) < 0:
        raise ValueError("Concentration, timestep and kinetic rates cannot be negative.")
    on_rate = kon_uM_ms * concentration_uM
    rate = on_rate + koff_per_ms
    if rate == 0 or dt_ms == 0:
        return occupancy
    equilibrium = on_rate / rate
    approach = -math.expm1(-rate * dt_ms)
    return occupancy * (1.0 - approach) + equilibrium * approach
