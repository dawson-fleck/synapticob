"""Record the exact settings, numerical environment and model source identity."""
from __future__ import annotations
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
from typing import Any


def canonical_hash(value: Any) -> str:
    content = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def model_source_hash() -> str:
    """Hash the executed source tree; portable downloads include these sources.

    Missing source files must never silently produce the SHA-256 of empty input.
    No Git executable is required at runtime.
    """
    paths = sorted(Path(__file__).parent.glob("*.py"))
    if not paths:
        raise OSError("The SynaptiCob model source files are missing. Extract the complete download again.")
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode("utf-8") + b"\0")
        digest.update(path.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def provenance(parameters: dict[str, Any], visualization_seed: int = 17) -> dict[str, Any]:
    return {
        "application": "SynaptiCob",
        "application_subtitle": "An Interactive Neuroscience Simulation Laboratory",
        "parameter_sha256": canonical_hash(parameters),
        "model_source_sha256": model_source_hash(),
        "python_version": platform.python_version(),
        "numerical_packages": {name: importlib.metadata.version(name) for name in ("numpy", "scipy")},
        "numerical_model": "deterministic",
        "visualization_seed": visualization_seed,
        "visualization_note": "Schematic particles; seed does not affect numerical outputs.",
    }
