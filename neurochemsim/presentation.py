"""UI adapter: preserve exact quantitative traces; bound spatial display payload."""
from __future__ import annotations
import numpy as np
from .results import SimulationResult
from .reproducibility import canonical_hash, provenance
from .numerical_resolution import numerical_resolution


def browser_result(result: SimulationResult) -> dict:
    parameters = result.parameters.to_dict()
    source = provenance(parameters)
    run_id = canonical_hash([source["parameter_sha256"], source["model_source_sha256"]])[:20]
    output = {
        "parameters": parameters, "summary": result.summary(),
        "series": {key: value.tolist() for key, value in result.columns().items()},
        "spike_times_ms": result.spike_times_ms.tolist(), "run_id": run_id,
        "provenance": source,
        "numerical_resolution": numerical_resolution(result),
        "model_note": "Deterministic conductance LIF; spike markers are threshold events, not sodium/potassium waveforms.",
    }
    if result.pharmacology is not None:
        output["pharmacology"] = result.pharmacology
    if result.x_um is not None:
        selected = np.linspace(0, len(result.time_ms) - 1, min(1001, len(result.time_ms))).astype(int)
        events = [event for synapse in (result.parameters.glutamate, result.parameters.gaba)
                  if synapse.release_dose_uM_um > 0 for event in synapse.release_times_ms]
        # Keep both sides of discontinuities to avoid displaying releases early.
        for event in events:
            index = int(np.searchsorted(result.time_ms, event))
            selected = np.append(selected, [max(0, index - 1), index])
        selected = np.unique(selected)
        output["spatial"] = {
            "x_um": result.x_um.tolist(), "time_ms": result.time_ms[selected].tolist(),
            "glutamate_uM": result.glutamate_spatial_uM[selected].tolist(),
            "gaba_uM": result.gaba_spatial_uM[selected].tolist(),
            "sampling_note": "Spatial playback samples only; numerical exports retain every timestep.",
        }
    return output
