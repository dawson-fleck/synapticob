"""Validated, unit-explicit settings for the deterministic educational model."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields
import json
import math
from typing import Any, Mapping

from .pharmacology import PharmacologyParameters


def _finite(name: str, value: float, *, minimum: float | None = None,
            maximum: float | None = None, positive: bool = False) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number.")
    if positive and value <= 0:
        raise ValueError(f"{name} must be greater than zero.")
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be at least {minimum}.")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name} must be no more than {maximum}.")


@dataclass(frozen=True)
class SynapseParameters:
    """One effective population. Dose is integrated concentration, not molecules."""

    release_dose_uM_um: float = 1000.0
    release_times_ms: tuple[float, ...] = (10.0,)
    clearance_per_ms: float = 0.2
    receptor_availability: float = 1.0
    max_conductance_nS: float = 40.0
    kon_uM_ms: float = 0.0011
    koff_per_ms: float = 0.19

    def __post_init__(self) -> None:
        if not isinstance(self.release_times_ms, (tuple, list)):
            raise ValueError("release_times_ms must be a list or tuple of times in ms.")
        object.__setattr__(self, "release_times_ms", tuple(self.release_times_ms))
        self.validate()

    def validate(self) -> None:
        bounds = {
            "release_dose_uM_um": 100000.0, "clearance_per_ms": 100.0,
            "receptor_availability": 100.0, "max_conductance_nS": 10000.0,
            "kon_uM_ms": 10.0, "koff_per_ms": 100.0,
        }
        for name, maximum in bounds.items():
            _finite(name, getattr(self, name), minimum=0, maximum=maximum)
        if len(self.release_times_ms) > 200:
            raise ValueError("At most 200 release events per input are supported.")
        for time in self.release_times_ms:
            _finite("Release time (ms)", time, minimum=0)
        if any(b <= a for a, b in zip(self.release_times_ms, self.release_times_ms[1:])):
            raise ValueError("Release times must be strictly increasing and unique.")


def _gaba_defaults() -> SynapseParameters:
    return SynapseParameters(release_dose_uM_um=400.0, clearance_per_ms=0.15,
                             max_conductance_nS=30.0, kon_uM_ms=0.005,
                             koff_per_ms=0.18)


@dataclass(frozen=True)
class MembraneParameters:
    capacitance_pF: float = 200.0
    leak_nS: float = 10.0
    resting_mV: float = -65.0
    excitatory_reversal_mV: float = 0.0
    inhibitory_reversal_mV: float = -80.0
    threshold_mV: float = -50.0
    reset_mV: float = -65.0
    refractory_ms: float = 2.0

    def __post_init__(self) -> None:
        self.validate()

    def validate(self) -> None:
        _finite("Capacitance (pF)", self.capacitance_pF, minimum=0.1, maximum=100000)
        _finite("Leak conductance (nS)", self.leak_nS, minimum=0, maximum=10000)
        _finite("Refractory interval (ms)", self.refractory_ms, minimum=0.01, maximum=1000)
        for name in ("resting_mV", "excitatory_reversal_mV", "inhibitory_reversal_mV",
                     "threshold_mV", "reset_mV"):
            _finite(name, getattr(self, name), minimum=-150, maximum=100)
        if self.reset_mV >= self.threshold_mV:
            raise ValueError("Reset potential must be below firing threshold.")
        if self.resting_mV >= self.threshold_mV:
            raise ValueError("Resting potential must be below firing threshold.")


@dataclass(frozen=True)
class TransportParameters:
    """Two distinct 1D fields share a documented effective geometric template."""

    n_cells: int = 81
    glutamate_diffusion_um2_ms: float = 0.32
    gaba_diffusion_um2_ms: float = 0.32
    source_position_um: float = 0.4
    receptor_position_um: float = 0.6
    release_sigma_um: float = 0.08

    def __post_init__(self) -> None:
        self.validate()

    def validate(self) -> None:
        if type(self.n_cells) is not int or not 11 <= self.n_cells <= 401:
            raise ValueError("Spatial resolution must be an integer from 11 to 401 cells.")
        for name in ("glutamate_diffusion_um2_ms", "gaba_diffusion_um2_ms"):
            _finite(name, getattr(self, name), minimum=0, maximum=10)
        for name in ("source_position_um", "receptor_position_um"):
            _finite(name, getattr(self, name), minimum=0, maximum=100)
        _finite("Release width sigma (um)", self.release_sigma_um, minimum=0.005, maximum=100)


@dataclass(frozen=True)
class SimulationParameters:
    duration_ms: float = 100.0
    dt_ms: float = 0.05
    compartment_length_um: float = 2.0
    glutamate: SynapseParameters = field(default_factory=SynapseParameters)
    gaba: SynapseParameters = field(default_factory=_gaba_defaults)
    membrane: MembraneParameters = field(default_factory=MembraneParameters)
    transport: TransportParameters | None = None
    pharmacology: PharmacologyParameters | None = None

    def __post_init__(self) -> None:
        self.validate()

    def validate(self) -> None:
        _finite("Duration (ms)", self.duration_ms, positive=True, maximum=2000)
        _finite("Timestep (ms)", self.dt_ms, minimum=0.001, maximum=1.0)
        _finite("Effective compartment length (um)", self.compartment_length_um,
                minimum=0.01, maximum=100)
        if self.dt_ms > self.duration_ms:
            raise ValueError("Timestep must not exceed duration.")
        if self.duration_ms / self.dt_ms > 200000:
            raise ValueError("Choose a shorter duration or larger timestep (maximum 200,000 steps).")
        if self.pharmacology is not None:
            if not isinstance(self.pharmacology, PharmacologyParameters):
                raise ValueError("pharmacology must be a PharmacologyParameters object or None.")
            self.pharmacology.__post_init__()
            if self.duration_ms / self.dt_ms > 40000:
                raise ValueError("Receptor-state experiments support at most 40,000 time intervals; shorten the duration or increase the timestep.")
        if not isinstance(self.membrane, MembraneParameters):
            raise ValueError("membrane must be a MembraneParameters object.")
        self.membrane.validate()
        for name in ("glutamate", "gaba"):
            synapse = getattr(self, name)
            if not isinstance(synapse, SynapseParameters):
                raise ValueError(f"{name} must be a SynapseParameters object.")
            synapse.validate()
            if any(t > self.duration_ms for t in synapse.release_times_ms):
                raise ValueError(f"Every {name} release must occur within the simulation duration.")
        if self.transport is not None:
            if not isinstance(self.transport, TransportParameters):
                raise ValueError("transport must be a TransportParameters object or None.")
            self.transport.validate()
            if max(self.transport.source_position_um, self.transport.receptor_position_um) > self.compartment_length_um:
                raise ValueError("Source and receptor positions must lie inside the effective domain.")
            dx = self.compartment_length_um / self.transport.n_cells
            if self.transport.release_sigma_um < dx / 2:
                raise ValueError("Release width sigma must be at least half a spatial cell; increase resolution or width.")
            maximum_ratio = max(self.transport.glutamate_diffusion_um2_ms,
                                self.transport.gaba_diffusion_um2_ms) * self.dt_ms / dx ** 2
            if maximum_ratio > 100000:
                raise ValueError("Diffusion/grid settings exceed the numerical conditioning limit; reduce timestep or use fewer spatial cells.")
            estimated_times = math.ceil(self.duration_ms / self.dt_ms) + 2 + len(self.glutamate.release_times_ms) + len(self.gaba.release_times_ms)
            if 2 * self.transport.n_cells * estimated_times > 4_000_000:
                raise ValueError("Spatial simulation is too large; use fewer cells, a larger timestep, or a shorter duration.")

    @classmethod
    def spatial_defaults(cls, **overrides: Any) -> "SimulationParameters":
        overrides.setdefault("transport", TransportParameters())
        return cls(**overrides)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        for name in ("glutamate", "gaba"):
            data[name]["release_times_ms"] = list(data[name]["release_times_ms"])
        if self.pharmacology is not None:
            return {"schema_version": 3, "model_mode": "spatial" if self.transport is not None else "compartment", **data}
        data.pop("pharmacology")
        if self.transport is None:
            data.pop("transport")
            return {"schema_version": 1, "model_mode": "compartment", **data}
        return {"schema_version": 2, "model_mode": "spatial", **data}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, allow_nan=False)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "SimulationParameters":
        if not isinstance(data, Mapping):
            raise ValueError("A parameter configuration must be a JSON object.")
        version = data.get("schema_version")
        if type(version) is not int or version not in (1, 2, 3):
            raise ValueError("Unsupported parameter schema_version; expected 1, 2, or 3 (pharmacology).")
        expected = {f.name for f in fields(cls)} | {"schema_version", "model_mode"}
        if version != 3:
            expected.remove("pharmacology")
        if version == 1:
            expected.remove("transport")
        _check_keys(data, expected, "configuration")
        expected_mode = ("compartment" if version == 1 else "spatial") if version != 3 else ("spatial" if data["transport"] is not None else "compartment")
        if data["model_mode"] != expected_mode:
            raise ValueError(f"Schema {version} requires model_mode='{expected_mode}'.")
        values = {key: data[key] for key in expected - {"schema_version", "model_mode"}}
        for key in ("glutamate", "gaba"):
            _check_keys(values[key], {f.name for f in fields(SynapseParameters)}, key)
            values[key] = SynapseParameters(**values[key])
        _check_keys(values["membrane"], {f.name for f in fields(MembraneParameters)}, "membrane")
        values["membrane"] = MembraneParameters(**values["membrane"])
        if version == 2 or (version == 3 and values["transport"] is not None):
            _check_keys(values["transport"], {f.name for f in fields(TransportParameters)}, "transport")
            values["transport"] = TransportParameters(**values["transport"])
        if version == 3:
            _check_keys(values["pharmacology"], {f.name for f in fields(PharmacologyParameters)}, "pharmacology")
            values["pharmacology"] = PharmacologyParameters(**values["pharmacology"])
        return cls(**values)

    @classmethod
    def from_json(cls, content: str) -> "SimulationParameters":
        def reject_constant(value: str) -> None:
            raise ValueError(f"Non-finite JSON value {value} is not permitted.")
        try:
            data = json.loads(content, parse_constant=reject_constant,
                              object_pairs_hook=_unique_json_object)
        except (json.JSONDecodeError, TypeError) as exc:
            raise ValueError("Could not read the parameter JSON file.") from exc
        return cls.from_dict(data)


def _check_keys(data: Any, expected: set[str], label: str) -> None:
    if not isinstance(data, Mapping):
        raise ValueError(f"{label} must be an object.")
    missing, extra = expected - set(data), set(data) - expected
    if missing or extra:
        raise ValueError(f"Invalid {label} fields: missing={sorted(missing)}, unknown={sorted(extra)}.")


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON field: {key}.")
        result[key] = value
    return result
