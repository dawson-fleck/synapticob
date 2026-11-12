"""Analytic and behavioral checks for the Stage 1 mathematical pathway."""
from dataclasses import replace
import json
import math
import unittest

import numpy as np

from neurochemsim import MembraneParameters, SimulationParameters, SynapseParameters, simulate
from neurochemsim.membrane import advance_membrane, passive_voltage
from neurochemsim.receptors import advance_occupancy
from neurochemsim.release import compartment_trace, simulation_timeline


class ReceptorTests(unittest.TestCase):
    def test_constant_concentration_matches_analytic_solution(self):
        start, concentration, kon, koff, dt = 0.2, 135.0, 0.0011, 0.19, 1.8
        rate = kon * concentration + koff
        equilibrium = kon * concentration / rate
        expected = equilibrium + (start - equilibrium) * math.exp(-rate * dt)
        self.assertAlmostEqual(advance_occupancy(start, concentration, dt, kon, koff), expected, places=14)

    def test_no_transmitter_decays_by_dissociation(self):
        self.assertAlmostEqual(advance_occupancy(0.7, 0, 5, 0.005, 0.18), 0.7 * math.exp(-0.9), places=14)

    def test_extreme_nonnegative_inputs_remain_bounded(self):
        for occupancy in (0, 0.2, 1):
            for concentration in (0, 1e-9, 1000, 1e6):
                for dt in (0, 1e-12, 1, 10000):
                    observed = advance_occupancy(occupancy, concentration, dt, 0.005, 0.18)
                    self.assertGreaterEqual(observed, 0)
                    self.assertLessEqual(observed, 1)

    def test_zero_rates_preserve_state(self):
        self.assertEqual(advance_occupancy(0.2, 100, 10, 0, 0), 0.2)


class MembraneTests(unittest.TestCase):
    def setUp(self):
        self.p = MembraneParameters()

    def test_passive_membrane_relaxation_matches_analytic_solution(self):
        observed = passive_voltage(-58, 7, 0, 0, self.p)
        expected = self.p.resting_mV + (-58 - self.p.resting_mV) * math.exp(-7 / 20)
        self.assertAlmostEqual(observed, expected, places=13)

    def test_constant_conductance_voltage_matches_analytic_solution(self):
        ge, gi, dt = 3, 2, 4.2
        total = 15
        equilibrium = (10 * -65 + 3 * 0 + 2 * -80) / total
        expected = equilibrium + (-65 - equilibrium) * math.exp(-total * dt / 200)
        observed = advance_membrane(-65, 0, dt, ge, gi, self.p)
        self.assertAlmostEqual(observed.voltage_mV, expected, places=13)
        self.assertEqual(observed.spike_times_ms, ())

    def test_constant_conductance_spikes_and_refractory_remainder(self):
        # Independent exact constant-g solution: Vinf=-13mV, tau=4ms.
        crossing = 4 * math.log(((-65) - (-13)) / ((-50) - (-13)))
        period = crossing + self.p.refractory_ms
        expected_spikes = [crossing + k * period for k in range(100) if crossing + k * period <= 20]
        step = advance_membrane(-65, 0, 20, 40, 0, self.p)
        np.testing.assert_allclose(step.spike_times_ms, expected_spikes, rtol=0, atol=1e-12)
        last_expiry = expected_spikes[-1] + self.p.refractory_ms
        remaining_active = max(0, 20 - last_expiry)
        expected_voltage = -13 + (-65 + 13) * math.exp(-remaining_active / 4)
        self.assertAlmostEqual(step.voltage_mV, expected_voltage, places=12)

    def test_split_step_preserves_spikes_and_refractory_state(self):
        whole = advance_membrane(-65, 0, 12, 40, 0, self.p)
        first = advance_membrane(-65, 0, 3, 40, 0, self.p)
        second = advance_membrane(first.voltage_mV, 3, 9, 40, 0, self.p, first.refractory_until_ms)
        np.testing.assert_allclose(first.spike_times_ms + second.spike_times_ms,
                                   whole.spike_times_ms, rtol=0, atol=1e-12)
        self.assertAlmostEqual(second.voltage_mV, whole.voltage_mV, places=12)

    def test_refractory_partial_step(self):
        result = advance_membrane(-65, 2, 1, 3, 0, self.p, refractory_until_ms=2.6)
        expected = passive_voltage(-65, 0.4, 3, 0, self.p)
        self.assertAlmostEqual(result.voltage_mV, expected, places=12)

    def test_refractory_expiry_at_interval_end(self):
        result = advance_membrane(-65, 2, 1, 40, 0, self.p, refractory_until_ms=3)
        self.assertEqual(result.voltage_mV, -65)
        self.assertEqual(result.spike_times_ms, ())

    def test_threshold_equal_equilibrium_does_not_spike(self):
        p = replace(self.p, threshold_mV=-50)
        # gE=3 nS gives (-650)/13 = -50 mV exactly.
        result = advance_membrane(-65, 0, 10, 3, 0, p)
        self.assertEqual(result.spike_times_ms, ())
        self.assertLess(result.voltage_mV, p.threshold_mV)

    def test_rounded_asymptotic_threshold_remains_subthreshold_on_next_step(self):
        p = replace(self.p, capacitance_pF=0.1)
        first = advance_membrane(-65, 0, 1, 3, 0, p)
        second = advance_membrane(first.voltage_mV, 1, 1, 3, 0, p)
        self.assertEqual(first.spike_times_ms + second.spike_times_ms, ())
        self.assertLess(second.voltage_mV, p.threshold_mV)

    def test_crossing_at_endpoint_is_recorded_once(self):
        crossing = 4 * math.log1p(15 / 37)
        first = advance_membrane(-65, 0, crossing, 40, 0, self.p)
        self.assertEqual(len(first.spike_times_ms), 1)
        self.assertAlmostEqual(first.spike_times_ms[0], crossing, places=14)
        second = advance_membrane(first.voltage_mV, crossing, 0.5, 40, 0,
                                   self.p, first.refractory_until_ms)
        self.assertEqual(second.spike_times_ms, ())

    def test_zero_total_conductance_preserves_voltage(self):
        p = replace(self.p, leak_nS=0)
        self.assertEqual(advance_membrane(-60, 0, 100, 0, 0, p).voltage_mV, -60)


class CoupledSimulationTests(unittest.TestCase):
    def setUp(self):
        self.p = SimulationParameters()

    def test_zero_input_is_resting_and_silent(self):
        p = replace(self.p, glutamate=replace(self.p.glutamate, release_dose_uM_um=0),
                    gaba=replace(self.p.gaba, release_dose_uM_um=0))
        result = simulate(p)
        np.testing.assert_array_equal(result.voltage_mV, np.full_like(result.voltage_mV, -65))
        self.assertEqual(result.summary()["spike_count"], 0)
        self.assertIsNone(result.summary()["first_spike_latency_ms"])

    def test_strong_excitation_spikes_and_refractory_is_respected(self):
        p = replace(self.p, gaba=replace(self.p.gaba, release_dose_uM_um=0))
        result = simulate(p)
        self.assertGreaterEqual(len(result.spike_times_ms), 2)
        self.assertTrue(np.all(np.diff(result.spike_times_ms) >= p.membrane.refractory_ms))
        self.assertGreater(result.spike_times_ms[0], 10)
        self.assertEqual(result.summary()["peak_membrane_mV"], p.membrane.threshold_mV)
        for spike in result.spike_times_ms:
            held = (result.time_ms >= spike) & (result.time_ms < spike + p.membrane.refractory_ms)
            np.testing.assert_allclose(result.voltage_mV[held], p.membrane.reset_mV, atol=0)

    def test_typical_inhibition_suppresses_strong_excitation(self):
        excitatory = replace(self.p, gaba=replace(self.p.gaba, release_dose_uM_um=0))
        inhibited = replace(self.p, gaba=replace(self.p.gaba, receptor_availability=3))
        self.assertGreater(len(simulate(excitatory).spike_times_ms), 0)
        self.assertEqual(len(simulate(inhibited).spike_times_ms), 0)

    def test_shunting_inhibition_without_hyperpolarization(self):
        membrane = replace(self.p.membrane, inhibitory_reversal_mV=self.p.membrane.resting_mV)
        excitatory = replace(self.p, membrane=membrane,
                             glutamate=replace(self.p.glutamate, release_dose_uM_um=50),
                             gaba=replace(self.p.gaba, release_dose_uM_um=0))
        inhibited = replace(excitatory, gaba=self.p.gaba)
        a, b = simulate(excitatory), simulate(inhibited)
        self.assertLess(np.max(b.voltage_mV), np.max(a.voltage_mV))
        self.assertGreaterEqual(float(np.min(b.voltage_mV)), membrane.resting_mV - 1e-12)

    def test_negative_concentration_and_out_of_range_occupancy_never_arise(self):
        result = simulate(self.p)
        for array in (result.glutamate_uM, result.gaba_uM):
            self.assertTrue(np.all(array >= 0))
        for array in (result.ampa_occupancy, result.gabaa_occupancy):
            self.assertTrue(np.all((array >= 0) & (array <= 1)))

    def test_repeated_identical_run_is_identical(self):
        first, second = simulate(self.p), simulate(self.p)
        for name in first.columns():
            np.testing.assert_array_equal(first.columns()[name], second.columns()[name])
        np.testing.assert_array_equal(first.spike_times_ms, second.spike_times_ms)

    def test_compartment_release_and_clearance_known_solution(self):
        synapse = replace(self.p.glutamate, release_times_ms=(0.0, 2.0))
        times = np.array([0.0, 1.0, 2.0, 3.0])
        amplitude = synapse.release_dose_uM_um / self.p.compartment_length_um
        expected = amplitude * np.exp(-0.2 * times)
        expected[2:] += amplitude * np.exp(-0.2 * (times[2:] - 2))
        np.testing.assert_allclose(compartment_trace(times, synapse, 2), expected, rtol=1e-14)

    def test_reduced_clearance_prolongs_concentration(self):
        normal = simulate(self.p)
        slow = simulate(replace(self.p, glutamate=replace(self.p.glutamate, clearance_per_ms=0.04)))
        index = int(np.argmin(abs(normal.time_ms - 30)))
        self.assertGreater(slow.glutamate_uM[index], normal.glutamate_uM[index])


class ParameterTests(unittest.TestCase):
    def test_strict_json_roundtrip(self):
        original = SimulationParameters()
        restored = SimulationParameters.from_json(original.to_json())
        self.assertEqual(original, restored)

    def test_unknown_missing_duplicate_and_nonfinite_json_rejected(self):
        valid = SimulationParameters().to_dict()
        for mutation in ({**valid, "typo": 42}, {k: v for k, v in valid.items() if k != "dt_ms"},
                         {**valid, "duration_ms": math.inf}, {**valid, "schema_version": True}):
            with self.assertRaises(ValueError):
                SimulationParameters.from_dict(mutation)
        with self.assertRaises(ValueError):
            SimulationParameters.from_json('{"x": 1, "x": 2}')
        with self.assertRaises(ValueError):
            SimulationParameters.from_json('{"duration_ms": NaN}')

    def test_invalid_physical_parameters_rejected(self):
        for kwargs in ({"release_dose_uM_um": -1}, {"kon_uM_ms": -1},
                       {"release_times_ms": (10, 2)}, {"release_times_ms": (2, 2)},
                       {"release_times_ms": (True,)}, {"receptor_availability": math.nan}):
            with self.assertRaises(ValueError):
                SynapseParameters(**kwargs)
        for kwargs in ({"capacitance_pF": 0}, {"capacitance_pF": 1e-20}, {"reset_mV": -40},
                       {"refractory_ms": 0}, {"refractory_ms": 1e-20}, {"resting_mV": -40}):
            with self.assertRaises(ValueError):
                MembraneParameters(**kwargs)
        for kwargs in ({"dt_ms": 0}, {"duration_ms": -1}, {"compartment_length_um": 0}):
            with self.assertRaises(ValueError):
                SimulationParameters(**kwargs)

    def test_timeline_contains_exact_releases_and_finish(self):
        p = SimulationParameters(duration_ms=12.123, dt_ms=0.3,
                                 glutamate=SynapseParameters(release_times_ms=(0, 1.123)))
        times = simulation_timeline(p)
        self.assertIn(1.123, times)
        self.assertEqual(times[0], 0)
        self.assertEqual(times[-1], 12.123)
        self.assertTrue(np.all(np.diff(times) > 0))


if __name__ == "__main__":
    unittest.main()
