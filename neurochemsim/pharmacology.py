"""Literature-informed reduced receptor models for classroom experiments.

This is an explicitly hybrid educational model, not a fitted human synapse.
Published kinetic constants, assay-derived functional scales, and reduction
assumptions are distinguished in DRUG_SCIENCE.md and in every drug profile.
Drug concentrations are constant free bath concentrations. Antagonist exchange
uses a fast-equilibrium approximation; no microscopic drug on/off rates are
invented. Functional modulation fractions must not be read as measured binding.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Any

import numpy as np

MODEL_VERSION = "classroom-receptors-v1"
DRUG_IDS = ("cx614", "nbqx", "perampanel", "diazepam", "gabazine", "muscimol", "flumazenil")
MAX_CONCENTRATIONS = {"cx614": 100.0, "nbqx": 10.0, "perampanel": 10.0,
                      "diazepam": 1.0, "gabazine": 10.0, "muscimol": 100.0,
                      "flumazenil": 10.0}
SCALES = {"cx614": 30.0, "nbqx": .063, "perampanel": .56,
          "diazepam": .025, "gabazine": .23, "flumazenil": .0077}
MUSCIMOL_RELATIVE_POTENCY = 3.4 / .92


@dataclass(frozen=True)
class PharmacologyParameters:
    model_version: str = MODEL_VERSION
    pre_equilibrated: bool = True
    concentrations_uM: dict[str, float] = field(default_factory=lambda: dict.fromkeys(DRUG_IDS, 0.0))

    def __post_init__(self):
        if self.model_version != MODEL_VERSION:
            raise ValueError(f"Unsupported pharmacology model_version; expected '{MODEL_VERSION}'.")
        if self.pre_equilibrated is not True:
            raise ValueError("This pharmacology version requires pre_equilibrated=true; wash-in kinetics are not modeled.")
        if not isinstance(self.concentrations_uM, dict) or set(self.concentrations_uM) != set(DRUG_IDS):
            raise ValueError("concentrations_uM must contain exactly all seven supported drug IDs.")
        cleaned = {}
        for drug in DRUG_IDS:
            value = self.concentrations_uM[drug]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"{drug} concentration must be a finite number in micromolar.")
            if not 0 <= value <= MAX_CONCENTRATIONS[drug]:
                raise ValueError(f"{drug} concentration must be between 0 and {MAX_CONCENTRATIONS[drug]:g} micromolar.")
            cleaned[drug] = float(value)
        object.__setattr__(self, "concentrations_uM", cleaned)


def _source(title, url):
    return {"title": title, "url": url}


def get_drug_catalog() -> dict[str, Any]:
    profiles = [
        ("cx614", "CX614", "AMPA", "Positive allosteric modulator", 30, [.3, 30, 100],
         "A research ampakine that prolongs glutamate responses by slowing deactivation and reducing desensitization.",
         "Compare brief and repeated glutamate inputs. An enhancer needs agonist; it does not create glutamate.",
         "Reduced GluA1 kinetic model. A 30 micromolar functional scale is an assumed midpoint of reported 20–40 micromolar effects; interpolation is not measured binding.",
         [_source("Arai et al. 2000: CX614 responses", "https://pubmed.ncbi.nlm.nih.gov/10999951/"), _source("Mitchell & Fleck 2007: gating kinetics", "https://pmc.ncbi.nlm.nih.gov/articles/PMC1864835/")]),
        ("nbqx", "NBQX", "AMPA", "Competitive antagonist", .063, [.0063, .063, .63],
         "A research antagonist that competes at glutamate recognition sites and reduces AMPA activation. It also acts at kainate receptors outside this model.",
         "Raise glutamate in a concentration-response experiment: equilibrium competition shifts the curve right without lowering its limiting maximum.",
         "Apparent Ki 0.063 micromolar from rat-cortex mRNA/oocyte currents; rapid antagonist equilibration is assumed. Model-estimated occupancy is not a binding measurement.",
         [_source("Randle et al. 1992: NBQX competition", "https://pubmed.ncbi.nlm.nih.gov/1382998/")]),
        ("perampanel", "Perampanel", "AMPA", "Negative allosteric antagonist", .56, [.056, .56, 5.6],
         "An antiseizure medicine that suppresses AMPA responses through an allosteric mechanism. Additional receptor targets are outside this model.",
         "Compare with NBQX: additional glutamate does not simply restore the maximum response.",
         "Functional IC50 0.56 micromolar in cultured rat hippocampal neurons. The modeled inhibited fraction is a response scaling, not molecular occupancy. Drug is pre-applied because real block develops over seconds.",
         [_source("Chen et al. 2014: perampanel currents", "https://pmc.ncbi.nlm.nih.gov/articles/PMC4168215/")]),
        ("diazepam", "Diazepam", "GABA-A", "Positive allosteric modulator", .025, [.0025, .025, .25],
         "A benzodiazepine that enhances agonist-evoked GABA-A activation at a separate modulatory site. At the default reversal potential this strengthens inhibition.",
         "Set GABA release to zero, then compare diazepam with muscimol. Add flumazenil to oppose diazepam's enhancement.",
         "Functional EC50 0.025 micromolar is an operational modulation scale. Up to fourfold slowing of effective agonist dissociation is a chosen reduced-model interpolation that preserves the saturating response, not a unique molecular mechanism or a measured change in affinity. Gating/preactivation models are alternative explanations.",
         [_source("Li et al. 2013: diazepam efficacy", "https://pmc.ncbi.nlm.nih.gov/articles/PMC3852889/"), _source("Bianchi et al. 2009: context-dependent modulation", "https://pmc.ncbi.nlm.nih.gov/articles/PMC2834588/"), _source("Gielen et al. 2012: preactivation", "https://pmc.ncbi.nlm.nih.gov/articles/PMC6703631/")]),
        ("gabazine", "Gabazine (SR95531)", "GABA-A", "Competitive antagonist", .23, [.023, .23, 2.3],
         "A research antagonist that competes at GABA recognition sites. Reducing inhibitory input can allow more firing in this single neuron.",
         "Increase GABA in an equilibrium concentration-response experiment to overcome competition.",
         "Operational KB 0.23 micromolar from a neuronal-network Schild assay. Rapid exchange and transfer to this reduced receptor model are explicit approximations, not microscopic binding measurements.",
         [_source("2008: GABA-A antagonist Schild analysis", "https://pubmed.ncbi.nlm.nih.gov/18590768/")]),
        ("muscimol", "Muscimol", "GABA-A", "Direct orthosteric agonist", 3, [.3, 3, 30],
         "A research agonist that activates GABA-A receptors at the neurotransmitter site, even without released GABA. A constant bath exposure produces tonic conductance.",
         "Set GABA release to zero and compare activation with diazepam. Examine how changing the GABA reversal potential changes the electrical effect.",
         "Relative functional potency 3.4/0.92 is transferred from alpha1-beta3-gamma2 data; this is not an absolute EC50 fit. Equal agonist gating and desensitization rates are reduction assumptions.",
         [_source("Mortensen et al. 2010: agonist potency and efficacy", "https://pmc.ncbi.nlm.nih.gov/articles/PMC2872731/")]),
        ("flumazenil", "Flumazenil", "GABA-A", "Benzodiazepine-site antagonist", .077, [.0077, .077, .77],
         "Competes with benzodiazepines at their modulatory site. In this model it opposes diazepam while leaving baseline GABA activation unchanged.",
         "Run diazepam alone, then add flumazenil. Contrast this selective reversal with gabazine's blockade of agonist activation.",
         "A 0.0077 micromolar binding Kd from a purified alpha1-beta2-gamma2 construct is used as an effective competition scale. Combining it with diazepam's functional EC50 is phenomenological; the displayed competition weight is not molecular occupancy.",
         [_source("Zhu et al. 2018: GABA and flumazenil sites", "https://pmc.ncbi.nlm.nih.gov/articles/PMC6220708/")]),
    ]
    drugs = []
    for drug, name, target, mechanism, default, presets, description, lesson, evidence, sources in profiles:
        drugs.append({"id": drug, "name": name, "target": target, "mechanism": mechanism,
                      "default_uM": default, "min_uM": 0, "max_uM": MAX_CONCENTRATIONS[drug],
                      "presets_uM": presets, "description": description, "lesson": lesson,
                      "evidence_note": evidence, "sources": sources})
    return {"model_version": MODEL_VERSION, "drugs": drugs,
            "note": "Literature-informed reduced educational receptor model. Free bath concentrations; pre-applied drugs. Compare with the same model without drugs, not the original two-state model.",
            "assumptions": ["Fast-equilibrium competitive antagonist exchange; no drug wash-in/washout kinetics.",
                            "Hybrid kinetic and functional data from different experimental preparations; not a calibrated human synapse.",
                            "Drug modulation weights are functional model effects, not measured binding occupancy.",
                            "Legacy receptor kon/koff controls do not set these fixed versioned receptor-state kinetics."]}


def modulation(p: PharmacologyParameters) -> dict[str, float]:
    c = p.concentrations_uM
    cx = c["cx614"] / (SCALES["cx614"] + c["cx614"])
    dz = c["diazepam"] / SCALES["diazepam"]
    fl = c["flumazenil"] / SCALES["flumazenil"]
    return {"ampa_free": 1 / (1 + c["nbqx"] / SCALES["nbqx"]),
            "gaba_free": 1 / (1 + c["gabazine"] / SCALES["gabazine"]),
            "cx614_weight": cx,
            "ampa_close": 1.55 / (1 + ((1.55 / .5 - 1) / (100 / 130)) * cx),
            "ampa_recover": .0076 * (1 + ((.038 / .0076 - 1) / (100 / 130)) * cx),
            "perampanel_inhibition": c["perampanel"] / (SCALES["perampanel"] + c["perampanel"]),
            "diazepam_weight": dz / (1 + dz + fl),
            "flumazenil_weight": fl / (1 + dz + fl),
            "gaba_open": .8,
            "gaba_unbind": 1 / (1 + 3 * dz / (1 + dz + fl))}


def _generator(size, edges):
    generator = np.zeros((size, size))
    for source, target, rate in edges:
        generator[target, source] += rate
        generator[source, source] -= rate
    return generator


def receptor_generators(p: PharmacologyParameters, glutamate_uM: float, gaba_uM: float):
    """Column generators; AMPA R,B,O,D and GABA R,Bg,Og,Dg,Bm,Om,Dm."""
    m = modulation(p)
    ampa = _generator(4, [(0, 1, .02 * glutamate_uM * m["ampa_free"]), (1, 0, 9),
                           (1, 2, 8), (2, 1, m["ampa_close"]), (1, 3, 1.8),
                           (3, 1, m["ampa_recover"])])
    edges = []
    for start, association in ((1, .005 * gaba_uM),
                               (4, .005 * MUSCIMOL_RELATIVE_POTENCY * p.concentrations_uM["muscimol"])):
        edges.extend([(0, start, association * m["gaba_free"]), (start, 0, m["gaba_unbind"]),
                      (start, start + 1, m["gaba_open"]), (start + 1, start, .5),
                      (start, start + 2, .8), (start + 2, start, .1)])
    return ampa, _generator(7, edges)


def advance_markov(state: np.ndarray, generator: np.ndarray, dt_ms: float) -> np.ndarray:
    """Positive, mass-preserving uniformization to a 2e-14 Poisson tail.

    This evaluates the finite-state matrix exponential without dense expm calls.
    Small Poisson means prevent underflow at high association rates. Only tiny
    floating-point mass roundoff is normalized, not negative states clipped.
    """
    rate = float(np.max(-np.diag(generator)))
    if rate == 0 or dt_ms == 0:
        return state.copy()
    count = max(1, math.ceil(rate * dt_ms / 8))
    transition = np.eye(len(state)) + generator / rate
    mean = rate * dt_ms / count
    initial_weight = math.exp(-mean)
    value = state.copy()
    for _ in range(count):
        term = value.copy()
        weight = initial_weight
        weight_sum = weight
        total = weight * term
        for order in range(1, 150):
            term = transition @ term
            weight *= mean / order
            total += weight * term
            weight_sum += weight
            if order > mean and 1 - weight_sum < 2e-14:
                break
        else:
            raise ArithmeticError("Receptor probability series did not converge.")
        value = total / np.sum(total)
    if not np.all(np.isfinite(value)) or np.min(value) < -1e-13:
        raise ArithmeticError("Invalid receptor state probability.")
    return value


def equilibrium_states(p: PharmacologyParameters, glutamate_uM: float, gaba_uM: float):
    for concentration in (glutamate_uM, gaba_uM):
        if not math.isfinite(concentration) or concentration < 0:
            raise ValueError("Equilibrium transmitter concentrations must be finite and nonnegative.")
    m = modulation(p)
    ampa = np.array([1., .02 * glutamate_uM * m["ampa_free"] / 9, 0., 0.])
    ampa[2] = ampa[1] * 8 / m["ampa_close"]
    ampa[3] = ampa[1] * 1.8 / m["ampa_recover"]
    ampa /= np.sum(ampa)
    gabaa = np.zeros(7)
    gabaa[0] = 1
    for start, concentration in ((1, gaba_uM), (4, MUSCIMOL_RELATIVE_POTENCY * p.concentrations_uM["muscimol"])):
        gabaa[start] = .005 * concentration * m["gaba_free"] / m["gaba_unbind"]
        gabaa[start + 1] = gabaa[start] * m["gaba_open"] / .5
        gabaa[start + 2] = gabaa[start] * .8 / .1
    gabaa /= np.sum(gabaa)
    return ampa, gabaa


def display_states(p: PharmacologyParameters, ampa, gabaa):
    """Return explicit model pools; perampanel pool is functional, not binding."""
    m = modulation(p)
    responsive = 1 - m["perampanel_inhibition"]
    return {"ampa": {"unbound": ampa[0] * m["ampa_free"] * responsive,
                     "ligand_bound_closed": ampa[1] * responsive,
                     "open": ampa[2] * responsive, "desensitized": ampa[3] * responsive,
                     "antagonist_bound": ampa[0] * (1 - m["ampa_free"]) * responsive,
                     "functionally_inhibited": m["perampanel_inhibition"]},
            "gabaa": {"unbound": gabaa[0] * m["gaba_free"],
                       "ligand_bound_closed": gabaa[1] + gabaa[4],
                       "open": gabaa[2] + gabaa[5], "desensitized": gabaa[3] + gabaa[6],
                       "antagonist_bound": gabaa[0] * (1 - m["gaba_free"])}}


def equilibrium_response(pharmacology: PharmacologyParameters, glutamate_uM: float, gaba_uM: float) -> dict:
    if isinstance(pharmacology, dict):
        pharmacology = PharmacologyParameters(**pharmacology)
    a, g = equilibrium_states(pharmacology, glutamate_uM, gaba_uM)
    states = display_states(pharmacology, a, g)
    return {"ampa_open_fraction": float(states["ampa"]["open"]),
            "gabaa_open_fraction": float(states["gabaa"]["open"]), "states": states,
            "muscimol_bound_fraction": float(np.sum(g[4:]))}


def model_metadata(p: PharmacologyParameters) -> dict[str, Any]:
    m = modulation(p)
    effects = {}
    for drug, value, label in (("cx614", m["cx614_weight"], "Effective potentiation weight"),
                               ("perampanel", m["perampanel_inhibition"], "Functional response inhibition"),
                               ("diazepam", m["diazepam_weight"], "Effective potentiation weight"),
                               ("flumazenil", m["flumazenil_weight"], "Effective competition weight")):
        effects[drug] = {"model_effect_fraction": value, "label": label,
                         "interpretation": "Operational model effect, not measured molecular occupancy."}
    catalog = get_drug_catalog()
    return {"model_version": MODEL_VERSION, "pre_equilibrated": True,
            "concentrations_uM": dict(p.concentrations_uM), "drug_effects": effects,
            "model_note": catalog["note"], "assumptions": catalog["assumptions"],
            "profiles": catalog["drugs"],
            "state_note": "Model-estimated population pools. Competitive antagonist association assumes fast equilibrium. The perampanel pool is functional response inhibition, not drug binding.",
            "initialization_note": "Receptors equilibrate with drug and zero released transmitter before t=0. Membrane starts at the corresponding subthreshold tonic equilibrium; a suprathreshold tonic equilibrium instead starts at reset phase.",
            "charge_note": "Signed membrane-drive current g*(E-V), opposite the conventional outward-positive sign. Charge integrates sampled endpoint currents by trapezoids and divides pA*ms by 1000 to obtain pC; reset-adjacent samples introduce quadrature error."}


def integrate_drug_signals(parameters, times, glutamate, gaba):
    """Integrate pre-applied drugs on the existing release-aligned timeline."""
    from .membrane import advance_membrane
    from .results import SimulationResult

    if max(float(np.max(glutamate)), float(np.max(gaba))) > 50000:
        raise ValueError("Receptor-state experiments require local transmitter concentrations at most 50,000 micromolar; reduce release dose or broaden its spatial distribution.")
    p = parameters.pharmacology
    m = modulation(p)
    n = len(times)
    steps = np.diff(times)
    rates_a = np.maximum(18.8, .02 * glutamate[:-1] * m["ampa_free"])
    rates_g = np.maximum(m["gaba_unbind"] + 1.6, .005 * (gaba[:-1] + MUSCIMOL_RELATIVE_POTENCY * p.concentrations_uM["muscimol"]) * m["gaba_free"])
    # A conservative term-count proxy limits both sample count and stiffness.
    # It is checked before stepping, including extreme imported configurations.
    estimated_work = float(np.sum(4 * (10 + (rates_a + rates_g) * steps + 8 * np.sqrt((rates_a + rates_g) * steps))))
    if estimated_work > 3_000_000:
        raise ValueError("This receptor-state experiment exceeds the computation budget; shorten the duration, lower transmitter/drug concentrations, or use fewer time intervals.")
    a = np.empty((4, n))
    g = np.empty((7, n))
    # Transmitter release at t=0 must not pre-equilibrate the receptor. Only
    # the constant bath drug is present during the preapplication protocol.
    a[:, 0], g[:, 0] = equilibrium_states(p, 0, 0)
    e_scale = parameters.glutamate.max_conductance_nS * parameters.glutamate.receptor_availability
    i_scale = parameters.gaba.max_conductance_nS * parameters.gaba.receptor_availability
    responsive = 1 - m["perampanel_inhibition"]
    tonic_i = (g[2, 0] + g[5, 0]) * i_scale
    membrane = parameters.membrane
    total = membrane.leak_nS + tonic_i
    tonic_voltage = ((membrane.leak_nS * membrane.resting_mV + tonic_i * membrane.inhibitory_reversal_mV) / total) if total else membrane.resting_mV
    voltage = np.empty(n)
    voltage[0] = tonic_voltage if tonic_voltage < membrane.threshold_mV else membrane.reset_mV
    spikes = []
    refractory_until = 0.0
    maximum_rates = {"glutamate": 0.0, "gaba": 0.0}
    for index in range(n - 1):
        dt = float(times[index + 1] - times[index])
        qa, qg = receptor_generators(p, float(glutamate[index]), float(gaba[index]))
        maximum_rates["glutamate"] = max(maximum_rates["glutamate"], float(np.max(-np.diag(qa))))
        maximum_rates["gaba"] = max(maximum_rates["gaba"], float(np.max(-np.diag(qg))))
        a_mid = advance_markov(a[:, index], qa, dt / 2)
        g_mid = advance_markov(g[:, index], qg, dt / 2)
        a[:, index + 1] = advance_markov(a_mid, qa, dt / 2)
        g[:, index + 1] = advance_markov(g_mid, qg, dt / 2)
        step = advance_membrane(float(voltage[index]), float(times[index]), dt,
                                float(a_mid[2]) * responsive * e_scale,
                                float(g_mid[2] + g_mid[5]) * i_scale,
                                membrane, refractory_until)
        voltage[index + 1] = step.voltage_mV
        refractory_until = step.refractory_until_ms
        spikes.extend(step.spike_times_ms)
    groups = display_states(p, a, g)
    groups["ampa"]["functionally_inhibited"] = np.full(n, m["perampanel_inhibition"])
    state_arrays = {f"{receptor}_state_{name}": np.asarray(values, dtype=float)
                    for receptor, states in groups.items() for name, values in states.items()}
    state_arrays["gabaa_muscimol_bound_fraction"] = np.sum(g[4:], axis=0)
    metadata = model_metadata(p)
    metadata["states"] = {receptor: {name: np.asarray(values).tolist() for name, values in states.items()}
                          for receptor, states in groups.items()}
    metadata["maximum_exit_rate_per_ms"] = maximum_rates
    metadata["estimated_work_units"] = estimated_work
    metadata["tonic_initial_voltage_mV"] = float(voltage[0])
    metadata["tonic_initialization"] = "subthreshold_equilibrium" if tonic_voltage < membrane.threshold_mV else "suprathreshold_reset_phase"
    metadata["integration_note"] = "Probability-preserving uniformization solves frozen-concentration receptor intervals; left-held concentration and midpoint membrane coupling still require timestep refinement."
    for drug, key in (("nbqx", "ampa_state_antagonist_bound"), ("gabazine", "gabaa_state_antagonist_bound"), ("muscimol", "gabaa_muscimol_bound_fraction")):
        metadata["drug_effects"][drug] = {"model_effect_fraction": float(np.max(state_arrays[key])),
                                          "label": "Peak model-estimated drug association",
                                          "interpretation": "Derived from the reduced model's conditional equilibrium or agonist states; not measured occupancy."}
    ampa_open = groups["ampa"]["open"]
    gaba_open = groups["gabaa"]["open"]
    return SimulationResult(parameters, times, glutamate, gaba, ampa_open, gaba_open,
                            ampa_open * e_scale, gaba_open * i_scale, voltage,
                            np.asarray(spikes, dtype=float), receptor_states=state_arrays,
                            pharmacology=metadata)
