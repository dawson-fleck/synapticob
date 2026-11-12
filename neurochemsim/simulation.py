"""The staged, independently testable chemical-to-electrical simulation."""
from __future__ import annotations

from dataclasses import replace
import numpy as np

from .membrane import advance_membrane
from .parameters import SimulationParameters
from .receptors import advance_occupancy
from .release import compartment_trace, simulation_timeline
from .results import SimulationResult


def simulate(parameters: SimulationParameters | None = None) -> SimulationResult:
    parameters = parameters or SimulationParameters()
    parameters.validate()
    times = simulation_timeline(parameters)
    if parameters.transport is not None:
        from .transport import transport_fields
        fields = transport_fields(parameters, times)
        base = integrate_signals(parameters, times, fields.glutamate_local_uM, fields.gaba_local_uM)
        return replace(base, x_um=fields.x_um,
                       glutamate_spatial_uM=fields.glutamate_spatial_uM,
                       gaba_spatial_uM=fields.gaba_spatial_uM,
                       glutamate_mass_uM_um=fields.glutamate_mass_uM_um,
                       gaba_mass_uM_um=fields.gaba_mass_uM_um,
                       glutamate_released_uM_um=fields.glutamate_released_uM_um,
                       gaba_released_uM_um=fields.gaba_released_uM_um,
                       glutamate_cleared_uM_um=fields.glutamate_cleared_uM_um,
                       gaba_cleared_uM_um=fields.gaba_cleared_uM_um)
    glutamate = compartment_trace(times, parameters.glutamate, parameters.compartment_length_um)
    gaba = compartment_trace(times, parameters.gaba, parameters.compartment_length_um)
    return integrate_signals(parameters, times, glutamate, gaba)


def integrate_signals(parameters: SimulationParameters, times: np.ndarray,
                      glutamate: np.ndarray, gaba: np.ndarray) -> SimulationResult:
    """Integrate receptor and membrane dynamics on a release-aligned timeline.

    A future transport solver can supply receptor-local concentrations through
    this interface. Signals are right-continuous; each interval uses its left
    concentration, so an endpoint release cannot affect earlier voltages.
    """
    if times.ndim != 1 or len(times) < 2 or not np.all(np.diff(times) > 0):
        raise ValueError("Time must be a strictly increasing one-dimensional timeline.")
    for signal in (times, glutamate, gaba):
        if signal.shape != times.shape or not np.all(np.isfinite(signal)) or np.any(signal < 0):
            raise ValueError("Time and concentrations must be finite nonnegative aligned arrays.")
    if parameters.pharmacology is not None:
        from .pharmacology import integrate_drug_signals
        return integrate_drug_signals(parameters, times, glutamate, gaba)
    count = len(times)
    ampa = np.zeros(count)
    gabaa = np.zeros(count)
    voltage = np.empty(count)
    voltage[0] = parameters.membrane.resting_mV
    spikes: list[float] = []
    refractory_until = 0.0
    e_scale = parameters.glutamate.max_conductance_nS * parameters.glutamate.receptor_availability
    i_scale = parameters.gaba.max_conductance_nS * parameters.gaba.receptor_availability
    for index in range(count - 1):
        dt = float(times[index + 1] - times[index])
        # Half-step occupancy supplies conductance at the midpoint while using
        # only the concentration valid immediately after the left endpoint.
        e_mid = advance_occupancy(float(ampa[index]), float(glutamate[index]), dt / 2,
                                  parameters.glutamate.kon_uM_ms, parameters.glutamate.koff_per_ms)
        i_mid = advance_occupancy(float(gabaa[index]), float(gaba[index]), dt / 2,
                                  parameters.gaba.kon_uM_ms, parameters.gaba.koff_per_ms)
        ampa[index + 1] = advance_occupancy(float(ampa[index]), float(glutamate[index]), dt,
                                           parameters.glutamate.kon_uM_ms, parameters.glutamate.koff_per_ms)
        gabaa[index + 1] = advance_occupancy(float(gabaa[index]), float(gaba[index]), dt,
                                            parameters.gaba.kon_uM_ms, parameters.gaba.koff_per_ms)
        step = advance_membrane(float(voltage[index]), float(times[index]), dt,
                                 e_mid * e_scale, i_mid * i_scale,
                                 parameters.membrane, refractory_until)
        voltage[index + 1] = step.voltage_mV
        refractory_until = step.refractory_until_ms
        spikes.extend(step.spike_times_ms)
    return SimulationResult(parameters, times, glutamate, gaba, ampa, gabaa,
                            ampa * e_scale, gabaa * i_scale, voltage, np.asarray(spikes, dtype=float))
