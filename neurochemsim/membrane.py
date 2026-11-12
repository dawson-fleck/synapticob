"""Conductance-based LIF update with within-step spike and refractory events."""
from __future__ import annotations

from dataclasses import dataclass
import math

from .parameters import MembraneParameters


@dataclass(frozen=True)
class MembraneStep:
    voltage_mV: float
    refractory_until_ms: float
    spike_times_ms: tuple[float, ...]


def passive_voltage(voltage_mV: float, dt_ms: float, excitatory_nS: float,
                    inhibitory_nS: float, parameters: MembraneParameters) -> float:
    total = parameters.leak_nS + excitatory_nS + inhibitory_nS
    if total == 0 or dt_ms == 0:
        return voltage_mV
    equilibrium = (parameters.leak_nS * parameters.resting_mV
                   + excitatory_nS * parameters.excitatory_reversal_mV
                   + inhibitory_nS * parameters.inhibitory_reversal_mV) / total
    return voltage_mV + (equilibrium - voltage_mV) * (-math.expm1(-total * dt_ms / parameters.capacitance_pF))


def advance_membrane(voltage_mV: float, start_ms: float, dt_ms: float,
                     excitatory_nS: float, inhibitory_nS: float,
                     parameters: MembraneParameters,
                     refractory_until_ms: float = 0.0) -> MembraneStep:
    """Integrate frozen conductances, resolving all spikes and refractory expiry.

    Receptor/concentration coupling is still time-discretized. This exact local
    solution does not imply that the full coupled simulation is exact.
    """
    arguments = (voltage_mV, start_ms, dt_ms, excitatory_nS, inhibitory_nS, refractory_until_ms)
    if not all(math.isfinite(v) for v in arguments):
        raise ValueError("Membrane arguments must be finite.")
    if min(start_ms, dt_ms, excitatory_nS, inhibitory_nS, refractory_until_ms) < 0:
        raise ValueError("Time and conductance values cannot be negative.")
    if voltage_mV >= parameters.threshold_mV:
        raise ValueError("The initial voltage of a step must be below threshold.")
    end_ms = start_ms + dt_ms
    now = start_ms
    voltage = voltage_mV
    spikes: list[float] = []
    total = parameters.leak_nS + excitatory_nS + inhibitory_nS
    equilibrium = ((parameters.leak_nS * parameters.resting_mV
                    + excitatory_nS * parameters.excitatory_reversal_mV
                    + inhibitory_nS * parameters.inhibitory_reversal_mV) / total) if total else voltage
    tau = parameters.capacitance_pF / total if total else math.inf

    while now < end_ms:
        if now < refractory_until_ms:
            voltage = parameters.reset_mV
            now = min(end_ms, refractory_until_ms)
            if now >= end_ms:
                break
        remaining = end_ms - now
        crossing_delay = math.inf
        if equilibrium > parameters.threshold_mV:
            # log1p is accurate when threshold is close to the current voltage.
            crossing_delay = tau * math.log1p((parameters.threshold_mV - voltage) /
                                              (equilibrium - parameters.threshold_mV))
        if crossing_delay <= remaining:
            now += crossing_delay
            spikes.append(now)
            voltage = parameters.reset_mV
            refractory_until_ms = now + parameters.refractory_ms
            if refractory_until_ms <= now:
                raise ValueError("Refractory interval is too short to resolve at this time scale.")
            if len(spikes) > 10000:
                raise ValueError("Too many spike events within one integration step; reduce the timestep.")
        else:
            voltage = passive_voltage(voltage, remaining, excitatory_nS, inhibitory_nS, parameters)
            # An asymptotic approach can round to the threshold in floating-point
            # arithmetic even though no finite crossing occurred. Retain the
            # subthreshold side by one representable value, without inventing a spike.
            if voltage >= parameters.threshold_mV:
                voltage = math.nextafter(parameters.threshold_mV, -math.inf)
            now = end_ms
    return MembraneStep(voltage, refractory_until_ms, tuple(spikes))
