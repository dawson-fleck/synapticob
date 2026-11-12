"""Mechanism, probability, initialization, serialization and coupling checks."""
from dataclasses import replace
import unittest

import numpy as np
from scipy.linalg import expm

from neurochemsim.parameters import SimulationParameters, SynapseParameters
from neurochemsim.pharmacology import (
    DRUG_IDS, PharmacologyParameters, advance_markov, display_states,
    equilibrium_response, equilibrium_states, modulation, receptor_generators,
)
from neurochemsim.simulation import simulate, integrate_signals
from neurochemsim.numerical_resolution import numerical_resolution


def drug(**concentrations):
    return PharmacologyParameters(concentrations_uM={**dict.fromkeys(DRUG_IDS, 0.), **concentrations})


def quiet_parameters(pharmacology=None, duration=20., dt=.05):
    p = SimulationParameters(duration_ms=max(10., duration), dt_ms=dt,
                             pharmacology=pharmacology or drug())
    return replace(p, duration_ms=duration, glutamate=replace(p.glutamate, release_dose_uM_um=0, release_times_ms=()),
                   gaba=replace(p.gaba, release_dose_uM_um=0, release_times_ms=()))


class PharmacologyTests(unittest.TestCase):
    def test_legacy_schemas_do_not_gain_pharmacology(self):
        for p in (SimulationParameters(), SimulationParameters.spatial_defaults()):
            data = p.to_dict()
            self.assertNotIn("pharmacology", data)
            self.assertIn(data["schema_version"], (1, 2))
            self.assertEqual(SimulationParameters.from_dict(data), p)

    def test_schema_three_roundtrip_and_strict_validation(self):
        for p in (SimulationParameters(pharmacology=drug(diazepam=.025)),
                  SimulationParameters.spatial_defaults(pharmacology=drug(nbqx=.063))):
            self.assertEqual(p.to_dict()["schema_version"], 3)
            self.assertEqual(SimulationParameters.from_json(p.to_json()), p)
        for value in (-1, float("nan"), float("inf"), True, 11):
            with self.subTest(value=value), self.assertRaises(ValueError):
                drug(nbqx=value)
        with self.assertRaises(ValueError):
            PharmacologyParameters(pre_equilibrated=False)
        with self.assertRaises(ValueError):
            PharmacologyParameters(concentrations_uM={"nbqx": 0})
        with self.assertRaises(ValueError):
            PharmacologyParameters(model_version="unrecognized")

    def test_markov_update_agrees_with_independent_matrix_exponential(self):
        p = drug(cx614=100, diazepam=.025, muscimol=3, gabazine=.23)
        for concentration in (0., 1000., 50000.):
            for q in receptor_generators(p, concentration, concentration):
                state = np.zeros(len(q)); state[0] = 1
                for dt in (.001, .05, 1.):
                    with self.subTest(concentration=concentration, size=len(q), dt=dt):
                        got = advance_markov(state, q, dt)
                        np.testing.assert_allclose(got, expm(q * dt) @ state, atol=2e-13, rtol=2e-13)
                        self.assertGreaterEqual(float(got.min()), 0)
                        self.assertAlmostEqual(float(got.sum()), 1, places=13)

    def test_analytic_stationary_states_and_partition(self):
        p = drug(cx614=30, nbqx=.63, perampanel=.56, diazepam=.1,
                 flumazenil=.077, muscimol=3, gabazine=.23)
        states = equilibrium_states(p, 10, 20)
        for q, s in zip(receptor_generators(p, 10, 20), states):
            np.testing.assert_allclose(q @ s, 0, atol=1e-13)
        for receptor, fractions in display_states(p, *states).items():
            self.assertAlmostEqual(sum(fractions.values()), 1, places=13)
            self.assertGreaterEqual(min(fractions.values()), 0)

    def test_competitive_antagonists_shift_equilibrium_without_changing_ceiling(self):
        for identifier, concentration, half, receptor in (("nbqx", .63, .063, "ampa"),
                                                          ("gabazine", 2.3, .23, "gabaa")):
            p = drug(**{identifier: concentration})
            for agonist in (.1, 10, 1000):
                blocked = equilibrium_response(p, agonist, agonist)[receptor + "_open_fraction"]
                shifted = equilibrium_response(drug(), agonist / (1 + concentration / half),
                                               agonist / (1 + concentration / half))[receptor + "_open_fraction"]
                self.assertAlmostEqual(blocked, shifted, places=13)
            control_max = equilibrium_response(drug(), 1e12, 1e12)[receptor + "_open_fraction"]
            blocked_max = equilibrium_response(p, 1e12, 1e12)[receptor + "_open_fraction"]
            self.assertAlmostEqual(control_max, blocked_max, places=8)

    def test_perampanel_half_response_is_not_agonist_displacement(self):
        for concentration in (.1, 100, 1e8):
            control = equilibrium_response(drug(), concentration, 0)["ampa_open_fraction"]
            blocked = equilibrium_response(drug(perampanel=.56), concentration, 0)["ampa_open_fraction"]
            self.assertAlmostEqual(blocked, .5 * control, places=14)

    def test_cx614_matches_selected_rate_endpoints_and_requires_glutamate(self):
        m = modulation(drug(cx614=100))
        self.assertAlmostEqual(m["ampa_close"], .5)
        self.assertAlmostEqual(m["ampa_recover"], .038)
        self.assertEqual(equilibrium_response(drug(cx614=100), 0, 0)["ampa_open_fraction"], 0)
        self.assertGreater(equilibrium_response(drug(cx614=100), 100, 0)["ampa_open_fraction"],
                           equilibrium_response(drug(), 100, 0)["ampa_open_fraction"])

    def test_diazepam_flumazenil_competition_preserves_saturating_response(self):
        base = equilibrium_response(drug(), 0, 1)["gabaa_open_fraction"]
        enhanced = equilibrium_response(drug(diazepam=.025), 0, 1)["gabaa_open_fraction"]
        reversed_value = equilibrium_response(drug(diazepam=.025, flumazenil=10), 0, 1)["gabaa_open_fraction"]
        self.assertGreater(enhanced, base)
        self.assertLess(abs(reversed_value - base), abs(enhanced - base) / 100)
        self.assertEqual(equilibrium_response(drug(flumazenil=1), 0, 1)["gabaa_open_fraction"], base)
        self.assertEqual(equilibrium_response(drug(diazepam=1), 0, 0)["gabaa_open_fraction"], 0)
        maximum = equilibrium_response(drug(), 0, 1e12)["gabaa_open_fraction"]
        self.assertAlmostEqual(maximum, equilibrium_response(drug(diazepam=1), 0, 1e12)["gabaa_open_fraction"], places=10)

    def test_muscimol_direct_activation_and_antagonism(self):
        baseline = equilibrium_response(drug(), 0, 0)["gabaa_open_fraction"]
        direct = equilibrium_response(drug(muscimol=3), 0, 0)["gabaa_open_fraction"]
        inhibited = equilibrium_response(drug(muscimol=3, gabazine=2.3), 0, 0)["gabaa_open_fraction"]
        self.assertEqual(baseline, 0)
        self.assertGreater(direct, inhibited)
        self.assertGreater(inhibited, 0)

    def test_tonic_preapplication_equilibrium_and_current_charge_units(self):
        p = quiet_parameters(drug(muscimol=3))
        result = simulate(p)
        np.testing.assert_allclose(result.gabaa_occupancy, result.gabaa_occupancy[0], atol=3e-13)
        np.testing.assert_allclose(result.voltage_mV, result.voltage_mV[0], atol=3e-11)
        expected = result.inhibitory_nS[0] * (p.membrane.inhibitory_reversal_mV - result.voltage_mV[0])
        self.assertLess(expected, 0)
        self.assertAlmostEqual(result.summary()["inhibitory_charge_pC"], expected * p.duration_ms / 1000, places=10)
        self.assertEqual(result.summary()["excitatory_charge_pC"], 0)

    def test_tonic_depolarizing_muscimol_has_consistent_observation_latency(self):
        p = quiet_parameters(drug(muscimol=100), duration=80)
        p = replace(p, membrane=replace(p.membrane, inhibitory_reversal_mV=0),
                    glutamate=replace(p.glutamate, release_dose_uM_um=1, release_times_ms=(50.,)))
        result = simulate(p)
        self.assertEqual(result.pharmacology["tonic_initialization"], "suprathreshold_reset_phase")
        self.assertEqual(result.voltage_mV[0], p.membrane.reset_mV)
        self.assertGreater(len(result.spike_times_ms), 0)
        self.assertLess(result.spike_times_ms[0], 50)
        self.assertEqual(result.summary()["first_spike_latency_ms"], result.spike_times_ms[0])
        self.assertEqual(result.summary()["latency_reference"], "observation_start")

    def test_release_does_not_pre_equilibrate_receptor_at_zero(self):
        p = quiet_parameters(duration=1)
        p = replace(p, glutamate=replace(p.glutamate, release_dose_uM_um=100, release_times_ms=(0.,)))
        result = simulate(p)
        self.assertEqual(result.ampa_occupancy[0], 0)
        self.assertGreater(result.ampa_occupancy[1], 0)

    def test_state_arrays_partition_and_current_readouts_match(self):
        result = simulate(replace(quiet_parameters(drug(nbqx=.063, perampanel=.56, muscimol=3)),
                                  glutamate=SynapseParameters(release_dose_uM_um=100, release_times_ms=(1.,))))
        for receptor in ("ampa", "gabaa"):
            values = [v for key, v in result.receptor_states.items() if key.startswith(receptor + "_state_")]
            np.testing.assert_allclose(np.sum(values, axis=0), 1, atol=4e-13)
            self.assertGreaterEqual(min(float(v.min()) for v in values), 0)
        np.testing.assert_array_equal(result.receptor_states["ampa_state_open"], result.ampa_occupancy)
        np.testing.assert_array_equal(result.receptor_states["gabaa_state_open"], result.gabaa_occupancy)
        self.assertIn("excitatory_current_pA", result.columns())

    def test_resolution_screen_uses_active_markov_rates(self):
        quiet = simulate(quiet_parameters())
        self.assertEqual(numerical_resolution(quiet)["status"], "not_flagged")
        active = simulate(SimulationParameters(duration_ms=20, pharmacology=drug()))
        report = numerical_resolution(active)
        self.assertTrue(any(w["code"] == "receptor_step_glutamate" for w in report["warnings"]))
        self.assertAlmostEqual(report["receptor_step"]["glutamate"], 18.8 * .05, places=10)

    def test_constant_input_state_solution_and_membrane_convergence(self):
        p = quiet_parameters(duration=10)
        results = []
        for dt in (.1, .05, .025):
            pp = replace(p, dt_ms=dt)
            times = np.linspace(0, 10, round(10 / dt) + 1)
            results.append(integrate_signals(pp, times, np.full_like(times, 30.), np.zeros_like(times)))
        for result in results:
            q, _ = receptor_generators(p.pharmacology, 30, 0)
            expected = expm(q * 10) @ np.array([1., 0., 0., 0.])
            self.assertAlmostEqual(result.ampa_occupancy[-1], expected[2], places=11)
        coarse_error = abs(results[0].voltage_mV[-1] - results[2].voltage_mV[-1])
        medium_error = abs(results[1].voltage_mV[-1] - results[2].voltage_mV[-1])
        self.assertLess(medium_error, coarse_error)

    def test_computation_limits_fail_before_extreme_simulations(self):
        with self.assertRaises(ValueError):
            quiet_parameters(duration=100, dt=.001)
        p = quiet_parameters(duration=1)
        times = np.array([0., 1.])
        with self.assertRaisesRegex(ValueError, "50,000"):
            integrate_signals(p, times, np.array([50001., 0]), np.zeros(2))


if __name__ == "__main__":
    unittest.main()
