"""Matched controls and equilibrium receptor-clamp lessons for pharmacology.

Clamp axes are free concentrations at the receptor, never release doses or
clinical doses. These experiments do not calculate a neuronal firing response.
"""
from __future__ import annotations

from dataclasses import replace
import math

from .parameters import SimulationParameters
from .reproducibility import canonical_hash, provenance


def without_drugs(parameters: SimulationParameters) -> SimulationParameters:
    """Keep the same receptor model and every non-drug setting for the control."""
    if parameters.pharmacology is None:
        raise ValueError("Enable the pharmacology lab before comparing drug conditions.")
    data = parameters.to_dict()
    data["pharmacology"]["concentrations_uM"] = {
        name: 0.0 for name in data["pharmacology"]["concentrations_uM"]}
    return SimulationParameters.from_dict(data)


def matched_control(result):
    """Reuse identical transport fields; integrate the actual drug-free model."""
    from .simulation import integrate_signals
    control = without_drugs(result.parameters)
    if control.to_dict() == result.parameters.to_dict():
        return result
    base = integrate_signals(control, result.time_ms, result.glutamate_uM, result.gaba_uM)
    spatial_names = (
        "x_um", "glutamate_spatial_uM", "gaba_spatial_uM",
        "glutamate_mass_uM_um", "gaba_mass_uM_um",
        "glutamate_released_uM_um", "gaba_released_uM_um",
        "glutamate_cleared_uM_um", "gaba_cleared_uM_um")
    return replace(base, **{name: getattr(result, name) for name in spatial_names})


def classroom_catalog() -> dict:
    from .pharmacology import get_drug_catalog
    catalog = get_drug_catalog()
    defaults = {drug["id"]: drug["default_uM"] for drug in catalog["drugs"]}
    lessons = [
        ("control", "Drug-free receptor control", "Establish a baseline using the pharmacology receptor model.", {}),
        ("nbqx", "Compete with glutamate", "Compare NBQX with the drug-free control, then test increasing glutamate in the concentration-response experiment.", {"nbqx": defaults["nbqx"]}),
        ("perampanel", "Block at a different site", "Compare perampanel with NBQX. Test whether increasing agonist restores the maximum receptor response.", {"perampanel": defaults["perampanel"]}),
        ("cx614", "Extend the excitatory response", "Observe AMPA opening and desensitization, and compare the duration and charge of the excitatory current.", {"cx614": defaults["cx614"]}),
        ("diazepam", "Enhance GABA-dependent activation", "Compare diazepam with the matched control. Then remove GABA release to explore agonist dependence.", {"diazepam": defaults["diazepam"]}),
        ("gabazine", "Remove inhibition", "Block GABA activation and test how the resulting change in inhibition affects the same postsynaptic neuron.", {"gabazine": defaults["gabazine"]}),
        ("muscimol", "Activate without GABA release", "GABA release is zero. Muscimol is pre-applied and can activate GABA-A receptors directly.", {"muscimol": defaults["muscimol"]}),
        ("reversal", "Reverse diazepam potentiation", "Compare diazepam plus flumazenil, then toggle flumazenil off and rerun. Flumazenil competes at the benzodiazepine site, not the GABA site.", {"diazepam": defaults["diazepam"], "flumazenil": defaults["flumazenil"]}),
    ]
    catalog["lessons"] = [{"id": key, "name": name, "description": description,
        "concentrations_uM": {drug: amounts.get(drug, 0.0) for drug in defaults},
        "parameter_overrides": {"gaba.release_dose_uM_um": 0} if key == "muscimol" else {}}
        for key, name, description, amounts in lessons]
    for lesson in catalog["lessons"]:
        configuration = SimulationParameters.spatial_defaults().to_dict()
        # Explicit lesson settings: a robust spiking control and finer receptor
        # coupling resolution. These do not change the legacy app defaults.
        configuration["dt_ms"] = .01
        configuration["glutamate"]["max_conductance_nS"] = 42.0
        configuration["schema_version"] = 3
        configuration["pharmacology"] = {
            "model_version": catalog["model_version"], "pre_equilibrated": True,
            "concentrations_uM": dict(lesson["concentrations_uM"])}
        if lesson["id"] == "muscimol":
            configuration["gaba"]["release_dose_uM_um"] = 0
        lesson["parameters"] = configuration
        lesson["description"] += " Loads a complete reproducible experiment (42 nS AMPA maximum, 0.01 ms timestep)."
    return catalog


def _number(value, name, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= maximum:
        raise ValueError(f"{name} must be a finite number between 0 and {maximum:g}.")
    return float(value)


def run_drug_sweep(parameters: SimulationParameters, drug_id: str, axis: str,
                   values_uM: list[float], agonist_uM: float) -> dict:
    from .pharmacology import get_drug_catalog, equilibrium_response
    parameters.validate()
    control = without_drugs(parameters)
    profiles = {drug["id"]: drug for drug in get_drug_catalog()["drugs"]}
    if not isinstance(drug_id, str) or drug_id not in profiles:
        raise ValueError("Choose one of the seven supported drugs.")
    if axis not in ("drug", "agonist"):
        raise ValueError("The concentration-response axis must be 'drug' or 'agonist'.")
    if not isinstance(values_uM, list) or not 2 <= len(values_uM) <= 33:
        raise ValueError("Provide 2 to 33 increasing concentration values.")
    maximum = profiles[drug_id]["max_uM"] if axis == "drug" else 10000.0
    values = [_number(value, "Axis concentration (uM)", maximum) for value in values_uM]
    if any(right <= left for left, right in zip(values, values[1:])):
        raise ValueError("Concentration values must be strictly increasing with no duplicates.")
    agonist = _number(agonist_uM, "Fixed agonist concentration (uM)", 10000.0)
    target = profiles[drug_id]["target"]
    is_ampa = target == "AMPA"
    synapse = parameters.glutamate if is_ampa else parameters.gaba
    reversal = parameters.membrane.excitatory_reversal_mV if is_ampa else parameters.membrane.inhibitory_reversal_mV
    holding = -65.0
    conductance = synapse.max_conductance_nS * synapse.receptor_availability
    rows = []
    for concentration in values:
        settings = parameters.to_dict()
        if axis == "drug":
            settings["pharmacology"]["concentrations_uM"][drug_id] = concentration
        condition = SimulationParameters.from_dict(settings)
        transmitter = concentration if axis == "agonist" else agonist
        glutamate, gaba = (transmitter, 0.0) if is_ampa else (0.0, transmitter)
        response = equilibrium_response(condition.pharmacology, glutamate, gaba)
        reference = equilibrium_response(control.pharmacology, glutamate, gaba)
        key = "ampa_open_fraction" if is_ampa else "gabaa_open_fraction"
        fraction, baseline = float(response[key]), float(reference[key])
        rows.append({"concentration_uM": concentration, "open_fraction": fraction,
                     "control_open_fraction": baseline,
                     "current_pA": conductance * fraction * (reversal - holding),
                     "control_current_pA": conductance * baseline * (reversal - holding)})
    settings = parameters.to_dict()
    source = provenance(settings)
    experiment = {"drug_id": drug_id, "axis": axis, "values_uM": values,
                  "agonist_uM": agonist, "holding_mV": holding,
                  "protocol": "steady_receptor_clamp"}
    source["analysis_type"] = "steady_receptor_concentration_response"
    source["experiment_sha256"] = canonical_hash(experiment)
    identifier = canonical_hash([source["parameter_sha256"], source["model_source_sha256"], source["experiment_sha256"]])[:20]
    return {**experiment, "sweep_id": identifier, "target": target,
            "parameters": settings, "rows": rows, "provenance": source,
            "current_convention": "Membrane drive: g*(E-Vhold), pA; positive depolarizing, negative hyperpolarizing.",
            "control_note": "All drugs off; identical receptor model, conductance, reversal and holding voltage.",
            "interpretation": "Equilibrium receptor-clamp prediction at constant free bath concentrations. No transmitter diffusion, synaptic pulse, membrane integration or spikes are calculated here. Other selected drug concentrations stay fixed. Curves show model predictions, not measured affinity or clinical dose-response.",
            "pharmacology": get_drug_catalog()}
