"""Browser control labels and practical ranges; engine validation remains authoritative."""
from __future__ import annotations


def control_metadata() -> list[dict]:
    rows = []
    def add(path, label, unit, minimum, maximum, step, group, help_text,
            advanced=False, kind="number", slider=None):
        row = dict(path=path, label=label, unit=unit, min=minimum, max=maximum,
                   step=step, group=group, help=help_text, advanced=advanced, kind=kind)
        if slider:
            row.update(slider_min=slider[0], slider_max=slider[1])
        rows.append(row)
    for name, label in (("glutamate", "Glutamate"), ("gaba", "GABA")):
        add(f"{name}.release_dose_uM_um", f"{label} release dose", "µM·µm", 0, 100000, 25,
            "Release", "Integrated concentration per event in the effective 1D domain; not a molecule count.", slider=(0, 2000))
        add(f"{name}.release_times_ms", f"{label} release times", "ms", 0, 2000, .1,
            "Release", "Comma-separated times, for example 10, 30, 50. Increasing and within the simulation duration.", kind="times")
    add("glutamate.receptor_availability", "AMPA availability", "relative ×", 0, 100, .1,
        "Receptors", "Scales maximal excitatory conductance independently of occupancy.", slider=(0, 3))
    add("gaba.receptor_availability", "GABA-A availability", "relative ×", 0, 100, .1,
        "Receptors", "Scales maximal inhibitory conductance independently of occupancy.", slider=(0, 4))
    for name, label in (("glutamate", "Glutamate"), ("gaba", "GABA")):
        add(f"{name}.clearance_per_ms", f"{label} clearance", "ms⁻¹", 0, 100, .01,
            "Transport & clearance", "Effective first-order removal. Lower values prolong extracellular exposure.", slider=(0, 1))
        add(f"transport.{name}_diffusion_um2_ms", f"{label} diffusion", "µm²/ms", 0, 10, .01,
            "Transport & clearance", "Effective diffusion along a separate 1D extracellular domain.", advanced=True)
    add("membrane.resting_mV", "Resting / leak potential", "mV", -150, 100, 1,
        "Electrophysiology", "Leak reversal potential; must remain below threshold. Also the initial voltage in standard mode; pre-applied drugs can shift the initial equilibrium in the drug lab.")
    add("membrane.threshold_mV", "Firing threshold", "mV", -150, 100, 1,
        "Electrophysiology", "A model spike event occurs when this voltage is crossed.")
    add("membrane.inhibitory_reversal_mV", "GABA-A reversal", "mV", -150, 100, 1,
        "Electrophysiology", "GABA drives voltage toward this value; near rest it can produce shunting.", advanced=True)
    for path, label, unit, lo, hi, step, help_text in (
        ("membrane.capacitance_pF", "Capacitance", "pF", .1, 100000, 10, "Effective whole-cell capacitance."),
        ("membrane.leak_nS", "Leak conductance", "nS", 0, 10000, 1, "Passive leak toward the resting potential."),
        ("membrane.reset_mV", "Reset potential", "mV", -150, 100, 1, "Voltage held during the refractory interval."),
        ("membrane.refractory_ms", "Refractory interval", "ms", .01, 1000, .1, "Minimum reset hold after each spike."),
        ("glutamate.max_conductance_nS", "AMPA aggregate maximum", "nS", 0, 10000, 1, "Effective population maximum at full activation and availability 1."),
        ("gaba.max_conductance_nS", "GABA-A aggregate maximum", "nS", 0, 10000, 1, "Effective population maximum at full activation and availability 1."),
        ("duration_ms", "Simulation duration", "ms", .1, 2000, 10, "All release events must fit within this interval."),
        ("dt_ms", "Integration timestep", "ms", .001, 1, .005, "Smaller values improve time resolution; computational limits are validated."),
        ("transport.n_cells", "Spatial cells", "cells", 11, 401, 1, "Number of finite-volume cells per transmitter domain."),
    ):
        add(path, label, unit, lo, hi, step, "Advanced settings", help_text, advanced=True)
    return rows
