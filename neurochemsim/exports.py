"""Unit-explicit, reproducible data and offline publication-style figure exports."""
from __future__ import annotations
import io
import json
from pathlib import Path
import textwrap
import zipfile
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
from matplotlib.figure import Figure
from matplotlib.backends.backend_agg import FigureCanvasAgg
from .results import SimulationResult
from .reproducibility import canonical_hash, provenance
from .numerical_resolution import numerical_resolution

MODEL_DOCUMENT = Path(__file__).resolve().parent.parent / "SCIENTIFIC_MODEL.md"
DRUG_DOCUMENT = MODEL_DOCUMENT.with_name("DRUG_SCIENCE.md")


def json_bytes(value) -> bytes:
    return (json.dumps(value, indent=2, allow_nan=False, sort_keys=True) + "\n").encode("utf-8")


def metadata_lines(result: SimulationResult, source: dict) -> str:
    lines = [
        "# SynaptiCob; units are explicit in column names; ampa_occupancy/gabaa_occupancy denote open fraction, not drug binding.",
        "# parameters_json=" + json.dumps(result.parameters.to_dict(), separators=(",", ":")),
        "# provenance_json=" + json.dumps(source, separators=(",", ":")),
        "# spike_times_ms=" + json.dumps(result.spike_times_ms.tolist(), separators=(",", ":")),
        "# numerical_resolution_json=" + json.dumps(numerical_resolution(result), separators=(",", ":")),
    ]
    if _has_pharmacology(result):
        lines.append("# pharmacology_json=" + json.dumps(pharmacology_document(result), separators=(",", ":")))
    return "\n".join(lines) + "\n"


def trace_csv(result: SimulationResult, source: dict) -> bytes:
    table = pd.DataFrame(result.columns()).to_csv(index=False, float_format="%.17g", lineterminator="\n")
    return (metadata_lines(result, source) + table).encode("utf-8")


def spikes_csv(result: SimulationResult, source: dict) -> bytes:
    table = pd.DataFrame({"spike_time_ms": result.spike_times_ms}).to_csv(
        index=False, float_format="%.17g", lineterminator="\n")
    return (metadata_lines(result, source) + table).encode("utf-8")


def discontinuous_trace(times: np.ndarray, values: np.ndarray, events) -> tuple[np.ndarray, np.ndarray]:
    """Break incoming segments at events in (left, right], preserving samples.

    A NaN separator avoids inventing a pre-event trajectory between recorded
    samples. It does not remove the post-event sample or its outgoing segment.
    Exact voltage reset strokes are drawn separately by ``figure_png``.
    """
    events = np.sort(np.asarray(events, dtype=float))
    if not len(events):
        return times.copy(), values.copy()
    crossing = np.searchsorted(events, times[1:], side="right") > np.searchsorted(events, times[:-1], side="right")
    indices = np.flatnonzero(crossing) + 1
    return np.insert(times, indices, np.nan), np.insert(values, indices, np.nan)


def distinct_tick_labels(values) -> list[str]:
    """Choose enough significant figures to distinguish distinct sweep inputs."""
    values = list(values)
    for precision in range(6, 18):
        labels = [f"{value:.{precision}g}" for value in values]
        if len(set(labels)) == len(set(values)):
            return labels
    return [repr(value) for value in values]


def _has_pharmacology(result: SimulationResult) -> bool:
    return getattr(result.parameters, "pharmacology", None) is not None


def _json_value(value):
    """Retain numerical metadata without pickle or lossy string coercion."""
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json_value(item) for item in value]
    return value


def pharmacology_document(result: SimulationResult) -> dict:
    """Keep model assumptions with data; binding and opening are not aliases."""
    if not _has_pharmacology(result):
        raise ValueError("This run did not enable the pharmacology model.")
    metadata = getattr(result, "pharmacology", None) or {}
    # Complete state timelines already live in trace.csv and the numeric NPZ;
    # avoid embedding them repeatedly in every CSV header and PNG text chunk.
    metadata = {key: value for key, value in metadata.items() if key != "states"}
    return {
        "configuration": result.parameters.to_dict()["pharmacology"],
        "model_metadata": _json_value(metadata),
        "receptor_state_columns": [key for key in result.columns()
                                   if key.startswith(("ampa_state_", "gabaa_state_"))],
        "interpretation": "Educational receptor model. Functional potency is not microscopic binding affinity. "
                          "Open fraction is distinct from ligand occupancy; inspect each drug's evidence and assumptions.",
        "current_convention": "Membrane drive: current_pA = conductance_nS * (reversal_mV - voltage_mV). "
                              "Positive values depolarize; this is opposite to outward-positive voltage-clamp current.",
        "charge_convention": "Signed synaptic charge in pC integrates membrane-drive pA over model ms and divides by 1000. "
                             "Sampled voltage resets require time refinement; charge does not include an ionic action-potential waveform.",
    }


def _validate_baseline(result: SimulationResult, baseline: SimulationResult | None) -> None:
    if baseline is None:
        return
    if not _has_pharmacology(result) or not _has_pharmacology(baseline):
        raise ValueError("A pharmacology comparison requires the same kinetic model on both runs.")
    expected = result.parameters.to_dict()
    expected["pharmacology"]["concentrations_uM"] = {
        key: 0 for key in expected["pharmacology"]["concentrations_uM"]}
    if baseline.parameters.to_dict() != expected:
        raise ValueError("The paired control must use identical settings with every drug concentration set to zero.")
    if not np.array_equal(result.time_ms, baseline.time_ms):
        raise ValueError("The paired control must retain the same integration timeline.")


def _baseline_source(baseline: SimulationResult, source: dict) -> dict:
    # Both runs were produced by the same saved computation. Do not replace its
    # frozen source identity with the current files if code changed after a run.
    return {**source, "parameter_sha256": canonical_hash(baseline.parameters.to_dict())}


def _figure_metadata(result: SimulationResult, source: dict,
                     baseline: SimulationResult | None = None) -> dict:
    output = {"parameters": result.parameters.to_dict(), "provenance": source,
              "numerical_resolution": numerical_resolution(result)}
    if _has_pharmacology(result):
        output["pharmacology"] = pharmacology_document(result)
    if baseline is not None:
        output["baseline"] = {"parameters": baseline.parameters.to_dict(),
                              "provenance": _baseline_source(baseline, source),
                              "summary": baseline.summary(),
                              "numerical_resolution": numerical_resolution(baseline)}
    return output


def figure_png(result: SimulationResult, source: dict, baseline: SimulationResult | None = None) -> bytes:
    _validate_baseline(result, baseline)
    resolution = numerical_resolution(result)
    flagged = resolution["status"] == "review_required" or (
        baseline is not None and numerical_resolution(baseline)["status"] == "review_required")
    figure = Figure(figsize=(8, 8), dpi=180, facecolor="#FFFFFF")
    FigureCanvasAgg(figure)
    axes = figure.subplots(3, 1, sharex=True)
    t = result.time_ms
    for name, color, label in (("glutamate", "#6C1D45", "Glutamate"), ("gaba", "#A86F00", "GABA")):
        synapse = getattr(result.parameters, name)
        events = synapse.release_times_ms if synapse.release_dose_uM_um > 0 else ()
        concentration = getattr(result, name + "_uM")
        axes[0].plot(*discontinuous_trace(t, concentration, events), color=color, label=label)
        if events:
            # Release times belong to the numerical timeline. Explicit points
            # keep isolated post-release samples visible, including at final T,
            # without reconstructing an incoming pre-event trajectory.
            indices = np.searchsorted(t, events)
            axes[0].plot(t[indices], concentration[indices], linestyle="None",
                         marker="o", markersize=3, color=color, label="_nolegend_", zorder=3)
    axes[0].set_ylabel("Local concentration (µM)")
    axes[1].plot(t, result.ampa_occupancy, color="#6C1D45", label="AMPA")
    axes[1].plot(t, result.gabaa_occupancy, color="#A86F00", label="GABA-A")
    axes[1].set_ylabel("Open fraction")
    axes[1].set_ylim(-.025, 1.025)
    if baseline is not None:
        axes[1].plot(baseline.time_ms, baseline.ampa_occupancy, "--", color="#6C1D45", alpha=.55, label="AMPA: no drugs")
        axes[1].plot(baseline.time_ms, baseline.gabaa_occupancy, "--", color="#A86F00", alpha=.55, label="GABA-A: no drugs")
        axes[2].plot(*discontinuous_trace(baseline.time_ms, baseline.voltage_mV, baseline.spike_times_ms),
                     "--", color="#8A7F85", linewidth=1.2, label="No-drug LIF voltage")
        if len(baseline.spike_times_ms):
            axes[2].vlines(baseline.spike_times_ms, baseline.parameters.membrane.reset_mV,
                          baseline.parameters.membrane.threshold_mV, color="#8A7F85", linestyle="--", linewidth=.7)
    axes[2].plot(*discontinuous_trace(t, result.voltage_mV, result.spike_times_ms), color="#333F48", label="LIF voltage")
    axes[2].axhline(result.parameters.membrane.threshold_mV, linestyle="--", color="#7A8085", label="Threshold")
    if len(result.spike_times_ms):
        axes[2].vlines(result.spike_times_ms, result.parameters.membrane.reset_mV,
                       result.parameters.membrane.threshold_mV, color="#A86F00", linewidth=1, label="Exact reset")
        axes[2].scatter(result.spike_times_ms, np.full(len(result.spike_times_ms), result.parameters.membrane.threshold_mV),
                        color="#6C1D45", marker="v", s=28, label="Spike event", zorder=4)
    axes[2].set_ylabel("Membrane potential (mV)")
    axes[2].set_xlabel("Model time (ms)")
    for axis in axes:
        axis.set_facecolor("#FFFFFF")
        axis.grid(color="#E5E0DC")
        axis.tick_params(colors="#333F48")
        axis.xaxis.label.set_color("#333F48")
        axis.yaxis.label.set_color("#333F48")
        axis.legend(loc="best" if axis is axes[0] else "upper right", fontsize=8,
                    facecolor="#FFFFFF", edgecolor="#E5E0DC", labelcolor="#333F48")
        axis.spines[["top", "right"]].set_visible(False)
    summary = result.summary()
    subtitle = "Pharmacology kinetics · paired no-drug control" if baseline is not None else "Illustrative effective inputs · conductance-based LIF"
    figure.suptitle(f"SynaptiCob · {summary['spike_count']} spike events\n{subtitle}", fontsize=13, color="#6C1D45")
    if flagged:
        figure.text(.5, .90, "Numerical resolution needs review — computed outcome may change with refinement",
                    ha="center", fontsize=9, color="#855A00")
    figure.text(.12, .02, f"dt = {result.parameters.dt_ms:g} ms | source {source['model_source_sha256'][:12]}\n"
                "Gaps at jumps; dots show post-release samples; vertical strokes show resets.\n"
                "Sampled peaks need refinement; no sodium/potassium waveform is calculated.", fontsize=8, color="#333F48")
    figure.subplots_adjust(top=.86 if flagged else .89,
                           bottom=.115, hspace=.22, left=.13, right=.97)
    output = io.BytesIO()
    figure.savefig(output, format="png", dpi=300,
                   metadata={"Description": json.dumps(_figure_metadata(result, source, baseline))})
    return output.getvalue()


def pharmacology_figure_png(result: SimulationResult, source: dict,
                            baseline: SimulationResult | None = None) -> bytes:
    """State fractions and actual membrane-drive currents with an honest control."""
    _validate_baseline(result, baseline)
    if not _has_pharmacology(result):
        raise ValueError("This run did not enable the pharmacology model.")
    figure = Figure(figsize=(9, 11), facecolor="#FFFFFF")
    FigureCanvasAgg(figure)
    axes = figure.subplots(4, 1, sharex=True)
    colors = ["#62656B", "#6C1D45", "#A86F00", "#9B6580", "#333F48", "#B38B35", "#967E91"]
    columns = result.columns()
    for index, (prefix, title, open_values) in enumerate((
            ("ampa", "AMPA", result.ampa_occupancy), ("gabaa", "GABA-A", result.gabaa_occupancy))):
        states = [(key.removeprefix(prefix + "_state_").replace("_", " "), values)
                  for key, values in columns.items() if key.startswith(prefix + "_state_")]
        for number, (label, values) in enumerate(states or [("open", open_values)]):
            axes[index].plot(result.time_ms, values, color=colors[number % len(colors)], label=label)
        if baseline is not None:
            control_open = baseline.ampa_occupancy if prefix == "ampa" else baseline.gabaa_occupancy
            axes[index].plot(baseline.time_ms, control_open, "--", color="#999197", label="no-drug open")
        axes[index].set_ylabel(title + " state fraction")
        axes[index].set_ylim(-.025, 1.025)
    for run, dashed in ((result, False), (baseline, True)):
        if run is None:
            continue
        label_suffix = ": no drugs" if dashed else ": selected drugs"
        for conductance, reversal, color, label in (
                (run.excitatory_nS, run.parameters.membrane.excitatory_reversal_mV, "#6C1D45", "AMPA"),
                (run.inhibitory_nS, run.parameters.membrane.inhibitory_reversal_mV, "#A86F00", "GABA-A")):
            current = conductance * (reversal - run.voltage_mV)
            axes[2].plot(*discontinuous_trace(run.time_ms, current, run.spike_times_ms),
                         linestyle="--" if dashed else "-", color=color, alpha=.55 if dashed else 1,
                         label=label + label_suffix)
        axes[3].plot(*discontinuous_trace(run.time_ms, run.voltage_mV, run.spike_times_ms),
                     linestyle="--" if dashed else "-", color="#999197" if dashed else "#333F48",
                     label="No drugs" if dashed else "Selected drugs")
        if len(run.spike_times_ms):
            axes[3].vlines(run.spike_times_ms, run.parameters.membrane.reset_mV,
                          run.parameters.membrane.threshold_mV, color="#999197" if dashed else "#6C1D45",
                          linestyle="--" if dashed else "-", linewidth=.7)
    axes[2].axhline(0, color="#AAA3A7", linewidth=.7)
    axes[2].set_ylabel("Membrane-drive current (pA)")
    axes[3].axhline(result.parameters.membrane.threshold_mV, color="#AAA3A7", linestyle=":", label="Threshold")
    axes[3].set_ylabel("LIF voltage (mV)")
    axes[3].set_xlabel("Model time (ms)")
    for axis in axes:
        axis.set_facecolor("#FFFFFF")
        axis.grid(color="#E5E0DC")
        axis.tick_params(colors="#333F48")
        axis.xaxis.label.set_color("#333F48")
        axis.yaxis.label.set_color("#333F48")
        axis.spines[["top", "right"]].set_visible(False)
        axis.legend(loc="best", ncol=3 if axis in axes[:2] else 2, fontsize=7,
                    facecolor="#FFFFFF", edgecolor="#E5E0DC", labelcolor="#333F48")
    concentrations = result.parameters.to_dict()["pharmacology"]["concentrations_uM"]
    active = "; ".join(f"{key}: {value:g} µM" for key, value in concentrations.items() if value > 0) or "All drugs off"
    figure.suptitle("SynaptiCob · pharmacology experiment", fontsize=14, color="#6C1D45", y=.98)
    figure.text(.5, .95, textwrap.fill(active, width=100), ha="center", va="top", fontsize=8, color="#333F48")
    flagged = numerical_resolution(result)["status"] == "review_required" or (
        baseline is not None and numerical_resolution(baseline)["status"] == "review_required")
    if flagged:
        figure.text(.5, .90, "Numerical resolution needs review; compare timestep refinements.",
                    ha="center", fontsize=9, color="#855A00")
    control_note = "Dashed traces: same model with all drugs off." if baseline is not None else "No paired control supplied."
    figure.text(.12, .025,
                "State fractions are model predictions; binding is distinct from opening. See pharmacology.json and DRUG_SCIENCE.md.\n"
                "Currents use membrane-drive sign: positive depolarizes. Gaps preserve sampled reset discontinuities.\n"
                f"{control_note} dt = {result.parameters.dt_ms:g} ms; source {source['model_source_sha256'][:12]}.",
                fontsize=7.5, color="#333F48")
    figure.subplots_adjust(top=.88, bottom=.10, hspace=.22, left=.13, right=.97)
    output = io.BytesIO()
    figure.savefig(output, format="png", dpi=300,
                   metadata={"Description": json.dumps(_figure_metadata(result, source, baseline))})
    return output.getvalue()


def summary_text(result: SimulationResult, source: dict, baseline: SimulationResult | None = None) -> bytes:
    _validate_baseline(result, baseline)
    s = result.summary()
    resolution = numerical_resolution(result)
    if resolution["status"] == "review_required":
        resolution_note = ("NUMERICAL RESOLUTION NEEDS REVIEW\nComputed outcomes may change with refinement.\n"
            + "\n".join(item["message"] for item in resolution["warnings"])
            + "\n" + resolution["recommendation"] + "\n")
    else:
        resolution_note = "Numerical timescale screening: no flag. This is not an accuracy certificate; refine near firing boundaries.\n"
    resolution_note += resolution["peak_note"] + "\n\n"
    latency = "not applicable" if s["first_spike_latency_ms"] is None else f"{s['first_spike_latency_ms']:.3f} ms"
    latency_reference = "observation start (t = 0)" if _has_pharmacology(result) else "first transmitter release"
    text = ("SynaptiCob\nAn Interactive Neuroscience Simulation Laboratory\n\nEXPERIMENT SUMMARY\n\n"
            f"Spike events: {s['spike_count']}\nFirst-spike latency from {latency_reference}: {latency}\n"
            f"Peak LIF voltage (including threshold events): {s['peak_membrane_mV']:.3f} mV\n"
            f"Peak AMPA / GABA-A open fractions: {s['peak_ampa_occupancy']:.4f} / {s['peak_gabaa_occupancy']:.4f}\n\n"
            + resolution_note +
            "Deterministic exploratory model; settings are illustrative, not experimentally calibrated.\n"
            + ("Two independent effective inputs; pharmacology receptor states; conductance LIF.\n" if _has_pharmacology(result)
               else "Two independent effective inputs; two-state receptor gating; conductance LIF.\n") +
            "First-order clearance; no-flux boundaries in spatial mode.\n"
            "No computed sodium/potassium waveform or axonal cable dynamics.\n"
            "CSV begins with # metadata lines; load with pandas.read_csv(..., comment='#').\n"
            "spikes.csv contains exact event timestamps; trace.csv uses the integration timeline.\n"
            "parameters.json reloads the exact settings; provenance.json identifies code and versions.\n\n"
            "PARAMETERS\n" + result.parameters.to_json() + "\n\nPROVENANCE\n" + json.dumps(source, indent=2) + "\n")
    if _has_pharmacology(result):
        text += "\nPHARMACOLOGY\n" + json.dumps(pharmacology_document(result), indent=2) + "\n"
        if baseline is not None:
            text += ("\nPAIRED NO-DRUG CONTROL\nSame receptor model and stimulus; all drug concentrations are zero.\n"
                     + json.dumps(baseline.summary(), indent=2) + "\n")
            if numerical_resolution(baseline)["status"] == "review_required":
                text += "NO-DRUG CONTROL NUMERICAL RESOLUTION NEEDS REVIEW; inspect baseline/numerical_resolution.json.\n"
    return text.encode("utf-8")


def _numerical_npz(result: SimulationResult) -> bytes:
    numerical = io.BytesIO()
    arrays = {**result.columns(), "spike_times_ms": result.spike_times_ms}
    if result.x_um is not None:
        arrays.update(x_um=result.x_um, glutamate_spatial_uM=result.glutamate_spatial_uM,
                      gaba_spatial_uM=result.gaba_spatial_uM)
    np.savez_compressed(numerical, **arrays)
    return numerical.getvalue()


def experiment_zip(result: SimulationResult, source: dict, baseline: SimulationResult | None = None) -> bytes:
    _validate_baseline(result, baseline)
    files = {
        "trace.csv": trace_csv(result, source), "spikes.csv": spikes_csv(result, source),
        "parameters.json": result.parameters.to_json().encode("utf-8"),
        "provenance.json": json_bytes(source), "summary.txt": summary_text(result, source, baseline),
        "figure.png": figure_png(result, source, baseline), "numerical_arrays.npz": _numerical_npz(result),
        "SCIENTIFIC_MODEL.md": MODEL_DOCUMENT.read_bytes(),
    }
    if _has_pharmacology(result):
        files["pharmacology.json"] = json_bytes(pharmacology_document(result))
        files["pharmacology_figure.png"] = pharmacology_figure_png(result, source, baseline)
        if DRUG_DOCUMENT.is_file():
            files["DRUG_SCIENCE.md"] = DRUG_DOCUMENT.read_bytes()
        if baseline is not None:
            baseline_source = _baseline_source(baseline, source)
            files.update({
                "baseline/trace.csv": trace_csv(baseline, baseline_source),
                "baseline/spikes.csv": spikes_csv(baseline, baseline_source),
                "baseline/parameters.json": baseline.parameters.to_json().encode("utf-8"),
                "baseline/provenance.json": json_bytes(baseline_source),
                "baseline/summary.txt": summary_text(baseline, baseline_source),
                "baseline/numerical_arrays.npz": _numerical_npz(baseline),
                "baseline/numerical_resolution.json": json_bytes(numerical_resolution(baseline)),
                "comparison.json": json_bytes({
                    "interpretation": "Same receptor model and stimulus; the control has all drugs set to zero.",
                    "treated_summary": result.summary(), "baseline_summary": baseline.summary(),
                    "treated_provenance": source, "baseline_provenance": baseline_source,
                }),
            })
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 11, 0, 0, 0))
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED)
    return output.getvalue()


def export_run(result: SimulationResult, name: str, source: dict | None = None,
               baseline: SimulationResult | None = None) -> tuple[bytes, str]:
    source = source or provenance(result.parameters.to_dict())
    if name == "parameters.json":
        return result.parameters.to_json().encode("utf-8"), "application/json"
    if name == "provenance.json":
        return json_bytes(source), "application/json"
    if name == "trace.csv":
        return trace_csv(result, source), "text/csv; charset=utf-8"
    if name == "spikes.csv":
        return spikes_csv(result, source), "text/csv; charset=utf-8"
    if name == "summary.txt":
        return summary_text(result, source, baseline), "text/plain; charset=utf-8"
    if name == "figure.png":
        return figure_png(result, source, baseline), "image/png"
    if name == "experiment.zip":
        return experiment_zip(result, source, baseline), "application/zip"
    if name == "pharmacology.json" and _has_pharmacology(result):
        return json_bytes(pharmacology_document(result)), "application/json"
    if name == "pharmacology_figure.png" and _has_pharmacology(result):
        return pharmacology_figure_png(result, source, baseline), "image/png"
    raise ValueError("Unknown experiment export format.")


def sweep_csv(sweep: dict) -> bytes:
    rows = []
    for j, inhibition in enumerate(sweep["axes"]["gaba_availabilities"]):
        for i, dose in enumerate(sweep["axes"]["glutamate_doses_uM_um"]):
            rows.append({"glutamate_dose_uM_um": dose, "gabaa_availability_relative": inhibition,
                         **{key: sweep[key][j][i] for key in ("spike_count", "peak_membrane_mV", "first_spike_latency_ms")}})
    metadata = "# base_parameters_json=" + json.dumps(sweep["parameters"], separators=(",", ":")) + "\n"
    metadata += "# provenance_json=" + json.dumps(sweep["provenance"], separators=(",", ":")) + "\n"
    metadata += "# numerical_resolution_json=" + json.dumps(sweep.get("numerical_resolution", {}), separators=(",", ":")) + "\n"
    metadata += "# latency_reference_json=" + json.dumps(_sweep_latency_reference(sweep), separators=(",", ":")) + "\n"
    return (metadata + pd.DataFrame(rows).to_csv(index=False, float_format="%.17g", lineterminator="\n")).encode("utf-8")


def _sweep_latency_reference(sweep: dict) -> dict:
    drug_mode = sweep.get("parameters", {}).get("pharmacology") is not None
    return {"reference": "observation_start" if drug_mode else "first_transmitter_release",
            "description": "observation start (t = 0)" if drug_mode else "first transmitter release",
            "unit": "ms", "no_spike": "undefined"}


def sweep_png(sweep: dict, metric="spike_count") -> bytes:
    resolution = sweep.get("numerical_resolution", {})
    latency_reference = _sweep_latency_reference(sweep)
    names = {"spike_count": "Spike count", "peak_membrane_mV": "Peak LIF voltage (mV)",
             "first_spike_latency_ms": "First-spike latency (ms)"}
    if latency_reference["reference"] == "observation_start":
        names["first_spike_latency_ms"] = "First-spike latency from t = 0 (ms)"
    if metric not in names:
        raise ValueError("Unknown sweep metric.")
    values = np.array([[np.nan if item is None else item for item in row] for row in sweep[metric]], dtype=float)
    figure = Figure(figsize=(7.5, 5.6), facecolor="#FFFFFF")
    FigureCanvasAgg(figure)
    axis = figure.add_subplot()
    axis.set_facecolor("#FFFFFF")
    color_map = matplotlib.colors.LinearSegmentedColormap.from_list(
        "concordia", [(0, "#FFF6DB"), (.5, "#EAAA00"), (1, "#6C1D45")], N=257)
    color_map.set_bad("#F3F1EF")
    has_values = bool(np.any(np.isfinite(values)))
    limits = {"vmin": 0, "vmax": max(1, float(np.nanmax(values)))} if metric == "spike_count" else {}
    shown = axis.imshow(np.ma.masked_invalid(values), origin="lower", aspect="auto", cmap=color_map, **limits)
    axis.set_xticks(range(values.shape[1]), distinct_tick_labels(sweep["axes"]["glutamate_doses_uM_um"]))
    axis.set_yticks(range(values.shape[0]), distinct_tick_labels(sweep["axes"]["gaba_availabilities"]))
    axis.set_xlabel("Glutamate release dose (µM·µm)", color="#333F48")
    axis.set_ylabel("GABA-A availability (relative)", color="#333F48")
    axis.set_title("SynaptiCob deterministic parameter sweep\n" + names[metric], color="#6C1D45")
    axis.tick_params(colors="#333F48")
    for j in range(values.shape[0]):
        for i in range(values.shape[1]):
            value = values[j, i]
            label = "—" if not np.isfinite(value) else (str(int(value)) if metric == "spike_count" else f"{value:.1f}")
            background = color_map(shown.norm(value)) if np.isfinite(value) else matplotlib.colors.to_rgba("#F3F1EF")
            axis.text(i, j, label, ha="center", va="center",
                      color=_cell_text_color(background), fontsize=9)
    if has_values:
        colorbar = figure.colorbar(shown, ax=axis, label=names[metric])
        colorbar.ax.tick_params(colors="#333F48")
        colorbar.ax.yaxis.label.set_color("#333F48")
        if metric == "spike_count":
            from matplotlib.ticker import MaxNLocator
            colorbar.locator = MaxNLocator(integer=True)
            colorbar.update_ticks()
    else:
        axis.set_title("SynaptiCob deterministic parameter sweep\nNo spikes in this grid; latency is undefined", color="#6C1D45")
    figure.text(.1, .025, "Illustrative model · not a firing probability · blank latency means no spike", fontsize=8, color="#333F48")
    if metric == "first_spike_latency_ms":
        figure.text(.1, .085, "Latency reference: " + latency_reference["description"] + ".", fontsize=8, color="#333F48")
    if resolution.get("status") == "review_required":
        figure.text(.1, .055, "Numerical resolution needs review; computed outcomes may change with refinement.",
                    fontsize=8, color="#855A00")
    figure.subplots_adjust(left=.14, bottom=.16, right=.96, top=.87)
    output = io.BytesIO()
    figure.savefig(output, format="png", dpi=300,
                   metadata={"Description": json.dumps({"parameters": sweep["parameters"], "axes": sweep["axes"],
                              "provenance": sweep["provenance"], "numerical_resolution": resolution,
                              "latency_reference": latency_reference})})
    return output.getvalue()


def _cell_text_color(background) -> str:
    """Match the UI's readable annotation colors on the branded heatmap."""
    def luminance(color):
        rgb = np.asarray(matplotlib.colors.to_rgba(color)[:3])
        linear = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
        return float(np.dot(linear, [.2126, .7152, .0722]))

    level = luminance(background)
    def contrast(color):
        ink = luminance(color)
        return (max(level, ink) + .05) / (min(level, ink) + .05)

    best = max(("#333F48", "#FFFFFF"), key=contrast)
    return best if contrast(best) >= 4.5 else "#000000"
