"""Conservative no-flux finite-volume diffusion and first-order clearance.

The two fields describe distinct extracellular domains, not a shared glutamate/
GABA bath. Dose is the integral of concentration over effective 1D distance.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import numpy as np
from scipy.linalg import solve_banded

from .parameters import SimulationParameters


@dataclass(frozen=True)
class TransportResult:
    x_um: np.ndarray
    glutamate_spatial_uM: np.ndarray
    gaba_spatial_uM: np.ndarray
    glutamate_local_uM: np.ndarray
    gaba_local_uM: np.ndarray
    glutamate_mass_uM_um: np.ndarray
    gaba_mass_uM_um: np.ndarray
    glutamate_released_uM_um: np.ndarray
    gaba_released_uM_um: np.ndarray
    glutamate_cleared_uM_um: np.ndarray
    gaba_cleared_uM_um: np.ndarray


def gaussian_release_profile(x_um: np.ndarray, dx_um: float,
                             source_um: float, sigma_um: float) -> np.ndarray:
    """Unit-integrated profile; sum(profile)*dx == 1 on every grid.

    Subtracting the maximum log-weight prevents underflow for a narrow source.
    Config validation separately requires the width to be spatially resolved.
    """
    if x_um.ndim != 1 or len(x_um) < 2 or not np.all(np.isfinite(x_um)):
        raise ValueError("Release coordinates must be a finite 1D array.")
    if not all(math.isfinite(v) for v in (dx_um, source_um, sigma_um)) or min(dx_um, sigma_um) <= 0:
        raise ValueError("Release spacing and width must be positive and finite.")
    log_weights = -0.5 * ((x_um - source_um) / sigma_um) ** 2
    weights = np.exp(log_weights - np.max(log_weights))
    return weights / (float(np.sum(weights)) * dx_um)


def diffusion_matrix(n_cells: int, ratio: float) -> np.ndarray:
    banded = np.zeros((3, n_cells), dtype=float)
    banded[0, 1:] = -ratio
    banded[2, :-1] = -ratio
    banded[1, :] = 1 + 2 * ratio
    # Cell-centered reflecting end faces: one, not two, internal neighbors.
    banded[1, 0] = banded[1, -1] = 1 + ratio
    return banded


def diffuse_and_clear(concentration_uM: np.ndarray, dt_ms: float,
                       diffusion_um2_ms: float, clearance_per_ms: float,
                       dx_um: float) -> np.ndarray:
    """One BE diffusion step followed by exact spatially uniform clearance."""
    values = (dt_ms, diffusion_um2_ms, clearance_per_ms, dx_um)
    if not all(math.isfinite(v) for v in values) or min(values) < 0 or dx_um == 0:
        raise ValueError("Diffusion settings must be finite and nonnegative, with positive cell width.")
    if concentration_uM.ndim != 1 or len(concentration_uM) < 2 or not np.all(np.isfinite(concentration_uM)) or np.any(concentration_uM < 0):
        raise ValueError("The concentration field must be finite, nonnegative and one-dimensional.")
    ratio = diffusion_um2_ms * dt_ms / dx_um ** 2
    if ratio > 100000:
        raise ValueError("Diffusion ratio exceeds the supported conditioning limit; reduce timestep or use a coarser grid.")
    matrix = diffusion_matrix(len(concentration_uM), ratio)
    output = solve_banded((1, 1), matrix, concentration_uM) * math.exp(-clearance_per_ms * dt_ms)
    if np.any(output < 0) or not np.all(np.isfinite(output)):
        raise ArithmeticError("Diffusion produced an invalid concentration field.")
    return output


def transport_fields(parameters: SimulationParameters, times_ms: np.ndarray) -> TransportResult:
    parameters.validate()
    transport = parameters.transport
    if transport is None:
        raise ValueError("Spatial transport parameters are required.")
    if times_ms.ndim != 1 or len(times_ms) < 2 or times_ms[0] != 0 or times_ms[-1] != parameters.duration_ms or not np.all(np.isfinite(times_ms)) or not np.all(np.diff(times_ms) > 0):
        raise ValueError("Spatial transport needs a finite increasing timeline from zero to duration.")
    if 2 * len(times_ms) * transport.n_cells > 4_000_000:
        raise ValueError("Spatial timeline exceeds the supported memory budget.")
    for synapse in (parameters.glutamate, parameters.gaba):
        if synapse.release_dose_uM_um > 0 and not all(np.any(times_ms == event) for event in synapse.release_times_ms):
            raise ValueError("The spatial timeline must contain every exact release time.")

    dx = parameters.compartment_length_um / transport.n_cells
    x = (np.arange(transport.n_cells, dtype=float) + 0.5) * dx
    profile = gaussian_release_profile(x, dx, transport.source_position_um, transport.release_sigma_um)
    all_fields = []
    all_local = []
    all_mass = []
    all_released = []
    all_cleared = []
    for synapse, diffusion in ((parameters.glutamate, transport.glutamate_diffusion_um2_ms),
                                (parameters.gaba, transport.gaba_diffusion_um2_ms)):
        field = np.zeros((len(times_ms), transport.n_cells), dtype=float)
        released = np.searchsorted(np.asarray(synapse.release_times_ms), times_ms, side="right") * synapse.release_dose_uM_um
        cleared = np.zeros(len(times_ms), dtype=float)
        mass = np.zeros(len(times_ms), dtype=float)
        field[0] = profile * released[0]
        mass[0] = float(np.sum(field[0])) * dx
        matrices: dict[float, np.ndarray] = {}
        for index in range(len(times_ms) - 1):
            dt = float(times_ms[index + 1] - times_ms[index])
            if dt not in matrices:
                matrices[dt] = diffusion_matrix(transport.n_cells, diffusion * dt / dx ** 2)
            spread = solve_banded((1, 1), matrices[dt], field[index], check_finite=False)
            survival = math.exp(-synapse.clearance_per_ms * dt)
            removed = float(np.sum(spread)) * dx * (-math.expm1(-synapse.clearance_per_ms * dt))
            cleared[index + 1] = cleared[index] + removed
            injected = released[index + 1] - released[index]
            field[index + 1] = spread * survival + profile * injected
            mass[index + 1] = float(np.sum(field[index + 1])) * dx
        if not np.all(np.isfinite(field)) or np.any(field < 0):
            raise ArithmeticError("Spatial solver produced an invalid concentration field.")
        balance_error = float(np.max(np.abs(mass + cleared - released)))
        if balance_error > 1e-7 * max(1.0, float(released[-1])):
            raise ArithmeticError("Spatial mass-balance precision was insufficient; reduce timestep or use fewer cells.")
        # Linear interpolation between cell averages at their centers. At an end
        # face, use the nearest average, consistent with the no-flux extension.
        local = np.array([np.interp(transport.receptor_position_um, x, row) for row in field])
        all_fields.append(field)
        all_local.append(local)
        all_mass.append(mass)
        all_released.append(released)
        all_cleared.append(cleared)
    return TransportResult(x, *all_fields, *all_local, *all_mass, *all_released, *all_cleared)
