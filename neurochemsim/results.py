"""Structured engine output shared by analysis, export and future playback."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import numpy as np

from .parameters import SimulationParameters


@dataclass(frozen=True)
class SimulationResult:
    parameters: SimulationParameters
    time_ms: np.ndarray
    glutamate_uM: np.ndarray
    gaba_uM: np.ndarray
    ampa_occupancy: np.ndarray
    gabaa_occupancy: np.ndarray
    excitatory_nS: np.ndarray
    inhibitory_nS: np.ndarray
    voltage_mV: np.ndarray
    spike_times_ms: np.ndarray
    x_um: np.ndarray | None = None
    glutamate_spatial_uM: np.ndarray | None = None
    gaba_spatial_uM: np.ndarray | None = None
    glutamate_mass_uM_um: np.ndarray | None = None
    gaba_mass_uM_um: np.ndarray | None = None
    glutamate_released_uM_um: np.ndarray | None = None
    gaba_released_uM_um: np.ndarray | None = None
    glutamate_cleared_uM_um: np.ndarray | None = None
    gaba_cleared_uM_um: np.ndarray | None = None
    receptor_states: dict[str, np.ndarray] | None = None
    pharmacology: dict[str, Any] | None = None

    def summary(self) -> dict[str, Any]:
        first = float(self.spike_times_ms[0]) if len(self.spike_times_ms) else None
        release_times = [t for syn in (self.parameters.glutamate, self.parameters.gaba)
                         if syn.release_dose_uM_um > 0 for t in syn.release_times_ms]
        reference = min(release_times) if release_times else 0.0
        if self.pharmacology is not None:
            reference = 0.0
        sampled_peak = float(np.max(self.voltage_mV))
        peak = max(sampled_peak, self.parameters.membrane.threshold_mV) if first is not None else sampled_peak
        summary = {
            "action_potential_generated": bool(len(self.spike_times_ms)),
            "spike_count": int(len(self.spike_times_ms)),
            "first_spike_ms": first,
            "first_spike_latency_ms": None if first is None else first - reference,
            "peak_membrane_mV": peak,
            "peak_sampled_membrane_mV": sampled_peak,
            "peak_ampa_occupancy": float(np.max(self.ampa_occupancy)),
            "peak_gabaa_occupancy": float(np.max(self.gabaa_occupancy)),
            "peak_glutamate_uM": float(np.max(self.glutamate_uM)),
            "peak_gaba_uM": float(np.max(self.gaba_uM)),
        }
        if self.x_um is not None:
            for name in ("glutamate", "gaba"):
                mass = getattr(self, name + "_mass_uM_um")
                released = getattr(self, name + "_released_uM_um")
                cleared = getattr(self, name + "_cleared_uM_um")
                summary[name + "_mass_balance_error_uM_um"] = float(np.max(np.abs(mass + cleared - released)))
        if self.pharmacology is not None:
            for name, conductance, reversal in (("excitatory", self.excitatory_nS, self.parameters.membrane.excitatory_reversal_mV),
                                                ("inhibitory", self.inhibitory_nS, self.parameters.membrane.inhibitory_reversal_mV)):
                current = conductance * (reversal - self.voltage_mV)
                summary[name + "_charge_pC"] = float(np.trapezoid(current, self.time_ms) / 1000)
                summary[name + "_peak_abs_current_pA"] = float(np.max(np.abs(current)))
            summary["latency_reference_ms"] = reference
            summary["latency_reference"] = "observation_start"
            summary["latency_note"] = "From observation start (t=0); drugs are pre-applied and tonic agonist effects can precede transmitter release."
        return summary

    def columns(self) -> dict[str, np.ndarray]:
        columns = {name: getattr(self, name) for name in (
            "time_ms", "glutamate_uM", "gaba_uM", "ampa_occupancy", "gabaa_occupancy",
            "excitatory_nS", "inhibitory_nS", "voltage_mV")}
        if self.x_um is not None:
            for name in ("glutamate", "gaba"):
                for quantity in ("mass", "released", "cleared"):
                    key = f"{name}_{quantity}_uM_um"
                    columns[key] = getattr(self, key)
        if self.receptor_states is not None:
            columns.update(self.receptor_states)
            columns["excitatory_current_pA"] = self.excitatory_nS * (self.parameters.membrane.excitatory_reversal_mV - self.voltage_mV)
            columns["inhibitory_current_pA"] = self.inhibitory_nS * (self.parameters.membrane.inhibitory_reversal_mV - self.voltage_mV)
        return columns

    def to_dict(self) -> dict[str, Any]:
        from .numerical_resolution import numerical_resolution
        payload = {"parameters": self.parameters.to_dict(), "summary": self.summary(),
                "series": {name: array.tolist() for name, array in self.columns().items()},
                "spike_times_ms": self.spike_times_ms.tolist(),
                "numerical_resolution": numerical_resolution(self),
                "model_note": "Deterministic conductance LIF; no sodium/potassium spike waveform."
                }
        if self.pharmacology is not None:
            payload["pharmacology"] = self.pharmacology
        if self.x_um is not None:
            payload["spatial"] = {
                "x_um": self.x_um.tolist(),
                "glutamate_uM": self.glutamate_spatial_uM.tolist(),
                "gaba_uM": self.gaba_spatial_uM.tolist(),
            }
        return payload
