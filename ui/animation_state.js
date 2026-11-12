/*
 * Pure playback state. This module does not simulate neurons or invent spikes.
 * Concentrations, occupancy, conductance and voltage are held at the latest
 * recorded sample, never interpolated through release jumps or reset events.
 * Particle positions are illustrative samples of the calculated 1D concentration
 * distribution. Transverse motion and the axonal pulse are schematic only.
 */

export const ANIMATION_SEED = 17;
export const PULSE_DURATION_MS = 3;
export const REPRESENTATIVE_DOSE_UM_UM = 15;
export const MAX_PARTICLES_PER_INPUT = 100;

export function upperBound(values, value) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function floorIndex(values, value) {
  return Math.max(0, upperBound(values, value) - 1);
}

function unitHash(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function releaseAge(synapse, timeMs) {
  if (!(synapse.release_dose_uM_um > 0)) return null;
  const events = synapse.release_times_ms || [];
  const index = upperBound(events, timeMs) - 1;
  return index < 0 ? null : timeMs - events[index];
}

function concentrationDistribution(values, domainLength) {
  const dx = domainLength / values.length;
  const cumulative = [];
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value < -1e-10) {
      throw new Error('The animation received an invalid concentration field.');
    }
    total += Math.max(0, value);
    cumulative.push(total);
  }
  return { cumulative, total, mass: total * dx, dx };
}

function samplePosition(distribution, centers, quantile, domainLength) {
  const target = quantile * distribution.total;
  const index = Math.min(upperBound(distribution.cumulative, target), centers.length - 1);
  const previous = index > 0 ? distribution.cumulative[index - 1] : 0;
  const weight = distribution.cumulative[index] - previous;
  const fraction = weight > 0 ? (target - previous) / weight : 0.5;
  // Each finite-volume concentration is constant within its cell. Sampling the
  // cell interior avoids falsely snapping representative molecules to centers.
  const position = centers[index] + (fraction - 0.5) * distribution.dx;
  return Math.max(0, Math.min(domainLength, position));
}

export function representativeParticles(values, centers, domainLength, timeMs, seed, species, hasReleased) {
  const distribution = concentrationDistribution(values, domainLength);
  // A fixed absolute display scale makes clearance and release magnitude visible.
  // The cap controls rendering cost; these are not molecule counts.
  const count = hasReleased
    ? Math.min(MAX_PARTICLES_PER_INPUT, Math.floor(distribution.mass / REPRESENTATIVE_DOSE_UM_UM))
    : 0;
  if (!count || distribution.total <= 0) return [];
  const particles = [];
  const salt = species === 'glutamate' ? 0x51e39b17 : 0xa74f3029;
  for (let index = 0; index < count; index++) {
    const identity = (seed ^ salt ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
    const quantile = unitHash(identity);
    const phase = unitHash(identity ^ 0x68bc21eb);
    const center = 0.14 + 0.72 * unitHash(identity ^ 0x02e5be93);
    const transverse = center + 0.10 * Math.sin(timeMs * 0.9 + phase * 2 * Math.PI);
    particles.push({
      position_um: samplePosition(distribution, centers, quantile, domainLength),
      transverse,
      phase,
    });
  }
  return particles;
}

export function deriveAnimationState(result, requestedTimeMs, seed = ANIMATION_SEED) {
  if (!Number.isFinite(requestedTimeMs)) throw new Error('Playback time must be finite.');
  const series = result.series;
  const times = series.time_ms;
  if (!times?.length) throw new Error('The result does not contain a playback timeline.');
  const timeMs = Math.max(times[0], Math.min(times[times.length - 1], requestedTimeMs));
  const sampleIndex = floorIndex(times, timeMs);
  const parameters = result.parameters;
  const membrane = parameters.membrane;
  const spikes = result.spike_times_ms || [];
  const spikeCount = upperBound(spikes, timeMs);
  const latestSpike = spikeCount ? spikes[spikeCount - 1] : null;

  let voltage = series.voltage_mV[sampleIndex];
  // A spike can lie between two exported sample times. Show its exact reset
  // immediately rather than retaining the pre-spike value until the next sample.
  // Between sampled points we do not reconstruct an unrecorded voltage trajectory.
  if (latestSpike !== null && (latestSpike > times[sampleIndex] ||
      timeMs < latestSpike + membrane.refractory_ms)) voltage = membrane.reset_mV;

  const ampa = series.ampa_occupancy[sampleIndex];
  const gabaa = series.gabaa_occupancy[sampleIndex];
  const excitatory = series.excitatory_nS[sampleIndex];
  const inhibitory = series.inhibitory_nS[sampleIndex];
  const pulses = [];
  const firstVisibleSpike = upperBound(spikes, timeMs - PULSE_DURATION_MS);
  for (let index = firstVisibleSpike; index < spikeCount; index++) {
    const ageMs = timeMs - spikes[index];
    pulses.push({ spike_ms: spikes[index], age_ms: ageMs, progress: ageMs / PULSE_DURATION_MS });
  }

  let spatialIndex = sampleIndex;
  let spatialTime = times[sampleIndex];
  let centers;
  let glutamateField;
  let gabaField;
  const domainLength = parameters.compartment_length_um;
  if (result.spatial) {
    const spatialTimes = result.spatial.time_ms || times;
    spatialIndex = floorIndex(spatialTimes, timeMs);
    spatialTime = spatialTimes[spatialIndex];
    centers = result.spatial.x_um;
    glutamateField = result.spatial.glutamate_uM[spatialIndex];
    gabaField = result.spatial.gaba_uM[spatialIndex];
  } else {
    // A uniform bath is the explicitly labeled compartment approximation.
    centers = [domainLength / 2];
    glutamateField = [series.glutamate_uM[sampleIndex]];
    gabaField = [series.gaba_uM[sampleIndex]];
  }
  const glutamateAge = releaseAge(parameters.glutamate, timeMs);
  const gabaAge = releaseAge(parameters.gaba, timeMs);
  const glutamateParticles = representativeParticles(glutamateField, centers, domainLength,
    timeMs, seed, 'glutamate', glutamateAge !== null);
  const gabaParticles = representativeParticles(gabaField, centers, domainLength,
    timeMs, seed, 'gaba', gabaAge !== null);
  const gabaDrive = membrane.inhibitory_reversal_mV - voltage;

  return {
    time_ms: timeMs,
    seed: seed >>> 0,
    series_index: sampleIndex,
    spatial_index: spatialIndex,
    voltage_mV: voltage,
    ampa_occupancy: ampa,
    gabaa_occupancy: gabaa,
    functional_ampa_activation: parameters.glutamate.max_conductance_nS > 0 ? ampa * parameters.glutamate.receptor_availability : 0,
    functional_gabaa_activation: parameters.gaba.max_conductance_nS > 0 ? gabaa * parameters.gaba.receptor_availability : 0,
    excitatory_nS: excitatory,
    inhibitory_nS: inhibitory,
    gaba_driving_force_mV: gabaDrive,
    gaba_current_pA: inhibitory * gabaDrive,
    spike_count: spikeCount,
    pulses,
    particles: { glutamate: glutamateParticles, gaba: gabaParticles },
    particle_counts: { glutamate: glutamateParticles.length, gaba: gabaParticles.length },
    source_release_age_ms: { glutamate: glutamateAge, gaba: gabaAge },
    spatial_snapshot: { x_um: centers, glutamate_uM: glutamateField, gaba_uM: gabaField, time_ms: spatialTime },
  };
}
