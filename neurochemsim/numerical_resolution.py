"""Advisory rate screens; these never alter or certify a numerical trajectory."""
from __future__ import annotations

import numpy as np
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .results import SimulationResult


# For isolated exponential clearance, left-held exposure / true interval
# exposure is x/(1-exp(-x)); x=.1 gives about 5.08% excess exposure. This bounds
# that quadrature effect only, not the coupled voltage or firing outcome.
CLEARANCE_STEP_LIMIT = 0.1
# A quarter of a receptor/voltage time constant is an advisory sampling screen,
# not a proved global error bound. Independent counterexample refinements are
# reproducible with scripts/scientific_accuracy_audit.py --section rates.
RECEPTOR_STEP_LIMIT = 0.25
MEMBRANE_STEP_LIMIT = 0.25
MINIMUM_SUPPORTED_DT_MS = 0.001


def numerical_resolution(result: SimulationResult) -> dict:
    """Return JSON-ready warnings about rapid kinetics and electrical coupling.

    Screens use actual interval lengths and only processes active in the run.
    A small ratio is not an error estimate: unresolved diffusion, sharp peaks,
    and near-threshold sensitivity still require temporal/spatial refinement.
    The limits are deliberately advisory; exact frozen-input updates may remain
    accurate in some fast cases, but do not make varying-input coupling exact.
    """
    p = result.parameters
    steps = np.diff(result.time_ms)
    clearance_step = {}
    receptor_step = {}
    warnings = []
    candidate_steps = [float(p.dt_ms)]

    def screen(code, observed, rate, limit, message):
        if rate > 0:
            candidate_steps.append(limit / rate)
        # Timeline subtraction can exceed the requested step by a few ulps.
        if observed > limit * (1 + 1e-9):
            warnings.append({"code": code, "observed": float(observed),
                             "limit": limit, "message": message})

    for name, occupancy in (("glutamate", result.ampa_occupancy),
                             ("gaba", result.gabaa_occupancy)):
        synapse = getattr(p, name)
        concentration = getattr(result, name + "_uM")[:-1]
        mass = getattr(result, name + "_mass_uM_um")
        chemical = mass[:-1] if mass is not None else concentration
        chemical_present = chemical > 0
        clearance = synapse.clearance_per_ms
        clearance_ratio = float(np.max(steps[chemical_present] * clearance)) if np.any(chemical_present) else 0.0
        clearance_step[name] = clearance_ratio
        label = "Glutamate" if name == "glutamate" else "GABA"
        screen("clearance_step_" + name, clearance_ratio,
               clearance if np.any(chemical_present) else 0.0, CLEARANCE_STEP_LIMIT,
               f"{label} clearance is fast relative to the integration interval "
               f"(clearance × step = {clearance_ratio:.4g}; screen {CLEARANCE_STEP_LIMIT:g}). "
               "Left-held concentration can overestimate receptor exposure.")

        on_rate = synapse.kon_uM_ms * concentration
        changing = (on_rate > 0) | (occupancy[:-1] > 0)
        rates = on_rate + synapse.koff_per_ms
        if p.pharmacology is not None:
            from .pharmacology import modulation, MUSCIMOL_RELATIVE_POTENCY
            mod = modulation(p.pharmacology)
            if name == "glutamate":
                rates = np.maximum(.02 * concentration * mod["ampa_free"], 18.8)
                changing = (concentration > 0) | (result.receptor_states["ampa_state_ligand_bound_closed"][:-1] > 0) | (result.receptor_states["ampa_state_desensitized"][:-1] > 0) | (occupancy[:-1] > 0)
            else:
                rates = np.maximum(.005 * (concentration + MUSCIMOL_RELATIVE_POTENCY * p.pharmacology.concentrations_uM["muscimol"]) * mod["gaba_free"], mod["gaba_unbind"] + 1.6)
                changing = (concentration > 0) | (p.pharmacology.concentrations_uM["muscimol"] > 0) | (result.receptor_states["gabaa_state_ligand_bound_closed"][:-1] > 0) | (result.receptor_states["gabaa_state_desensitized"][:-1] > 0) | (occupancy[:-1] > 0)
        receptor_ratio = float(np.max(steps[changing] * rates[changing])) if np.any(changing) else 0.0
        receptor_rate = float(np.max(rates[changing])) if np.any(changing) else 0.0
        receptor_step[name] = receptor_ratio
        rate_label = "maximum state exit rate" if p.pharmacology is not None else "kon × concentration + koff"
        screen("receptor_step_" + name, receptor_ratio, receptor_rate, RECEPTOR_STEP_LIMIT,
               f"{label} receptor kinetics are fast relative to the integration interval "
               f"(({rate_label}) × step = {receptor_ratio:.4g}; screen {RECEPTOR_STEP_LIMIT:g}). "
               "Exact frozen-input updates do not remove coupling or sampling error.")

    # Within each frozen-concentration interval, each occupancy is monotone.
    # Taking the maximum endpoint for each channel bounds its midpoint
    # conductance, even if excitation and inhibition move in opposite directions.
    e = np.maximum(result.excitatory_nS[:-1], result.excitatory_nS[1:])
    i = np.maximum(result.inhibitory_nS[:-1], result.inhibitory_nS[1:])
    active = (e + i) > 0
    if p.pharmacology is not None:
        # Multistate open fractions need not be monotone inside an interval.
        # Use a conservative conductance ceiling for the membrane rate screen.
        e = np.full_like(e, p.glutamate.max_conductance_nS * p.glutamate.receptor_availability)
        i = np.full_like(i, p.gaba.max_conductance_nS * p.gaba.receptor_availability)
    voltage_rates = (p.membrane.leak_nS + e + i) / p.membrane.capacitance_pF
    membrane_step = float(np.max(steps[active] * voltage_rates[active])) if np.any(active) else 0.0
    membrane_rate = float(np.max(voltage_rates[active])) if np.any(active) else 0.0
    screen("membrane_step", membrane_step, membrane_rate, MEMBRANE_STEP_LIMIT,
           "Membrane dynamics are fast relative to the integration interval "
           f"(total conductance × step / capacitance = {membrane_step:.4g}; screen {MEMBRANE_STEP_LIMIT:g}). "
           "Within-step conductance changes can materially shift threshold events.")

    recommended = min(candidate_steps) if warnings else float(p.dt_ms)
    supported = recommended >= MINIMUM_SUPPORTED_DT_MS * (1 - 1e-12)
    if warnings and supported and recommended <= MINIMUM_SUPPORTED_DT_MS * (1 + 1e-12):
        recommendation = ("Try the minimum supported integration timestep of 0.001 ms. The app cannot refine further; "
                          "verify with an independent solver allowing smaller steps, or use less extreme settings. "
                          "This screen does not certify accuracy.")
    elif warnings and supported:
        recommendation = (f"Try an integration timestep at most {recommended:.6g} ms, then compare with a smaller "
                          "timestep. This screening recommendation is not an accuracy guarantee.")
    elif warnings:
        recommendation = (f"The rate screens suggest a timestep at most {recommended:.6g} ms, below the supported "
                          "minimum of 0.001 ms. Use less extreme settings; the minimum supported timestep may "
                          "still be insufficient.")
    elif p.dt_ms <= MINIMUM_SUPPORTED_DT_MS * (1 + 1e-12):
        recommendation = ("This run uses the minimum supported timestep. Uncertain outcomes need an independent "
                          "solver with finer temporal resolution; spatial refinement alone does not verify time accuracy.")
    else:
        recommendation = "Compare smaller timesteps and finer spatial grids before interpreting near-threshold outcomes or sharp peaks."
    return {
        "status": "review_required" if warnings else "not_flagged",
        "dt_ms": float(p.dt_ms),
        "clearance_step": clearance_step,
        "receptor_step": receptor_step,
        "membrane_step": membrane_step,
        "recommended_dt_ms": float(recommended),
        "recommended_dt_supported": bool(supported),
        "warnings": warnings,
        "recommendation": recommendation,
        "screening_note": "Heuristic rate screens, not error estimates or an accuracy certificate. Near-threshold spike counts require refinement even when not flagged.",
        "peak_note": "Concentration and occupancy peaks are sampled, timestep-dependent maxima. Diffusion and coupling errors can remain when no rate screen is triggered; refine timestep and grid for quantitative peak interpretation.",
    }
