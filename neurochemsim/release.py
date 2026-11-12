"""Release-aligned clock and explicitly labeled effective-compartment inputs."""
from __future__ import annotations

import math
import numpy as np

from .parameters import SimulationParameters, SynapseParameters


def simulation_timeline(parameters: SimulationParameters) -> np.ndarray:
    """Include every positive-dose release timestamp and the final time.

    Values remain unrounded: a release must never be shifted into an earlier
    interval. Very close base-grid/event times can form a harmless short step.
    Zero-dose events add no chemical input and must not alter the integration
    clock or the discretization error of the other input. Receptor availability
    does not affect this decision: positive-dose chemistry is always retained.
    """
    grid = np.arange(0.0, parameters.duration_ms, parameters.dt_ms, dtype=float)
    events = [event for synapse in (parameters.glutamate, parameters.gaba)
              if synapse.release_dose_uM_um > 0 for event in synapse.release_times_ms]
    return np.unique(np.concatenate((grid, [parameters.duration_ms], events)))


def concentration_increment(synapse: SynapseParameters, compartment_length_um: float) -> float:
    return synapse.release_dose_uM_um / compartment_length_um


def concentration_at(time_ms: float, synapse: SynapseParameters,
                     compartment_length_um: float) -> float:
    """Right-continuous sum of instantaneous releases and exact clearance."""
    amount = concentration_increment(synapse, compartment_length_um)
    return math.fsum(amount * math.exp(-synapse.clearance_per_ms * (time_ms - event))
                     for event in synapse.release_times_ms if event <= time_ms)


def compartment_trace(times_ms: np.ndarray, synapse: SynapseParameters,
                      compartment_length_um: float) -> np.ndarray:
    concentration = np.zeros_like(times_ms, dtype=float)
    amount = concentration_increment(synapse, compartment_length_um)
    for event in synapse.release_times_ms:
        selected = times_ms >= event
        concentration[selected] += amount * np.exp(-synapse.clearance_per_ms * (times_ms[selected] - event))
    return concentration
