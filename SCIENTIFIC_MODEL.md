# Scientific model

## Optional classroom pharmacology model

The original two-state model described below remains the default and retains
its schema-1/2 calculations. Schema 3 enables the separate, versioned
`classroom-receptors-v1` model with CX614, NBQX, perampanel, diazepam, gabazine,
muscimol and flumazenil. See **DRUG_SCIENCE.md** for its exact state topology,
equations, constants, primary sources and explicit reduction assumptions.

The drug lab separates agonist-bound, open and desensitized populations. It uses
constant pre-applied free bath drug concentrations; it does not simulate clinical
doses or wash-in/washout. Functional modulation fractions are distinguished from
model-estimated binding, and neither is an experimental occupancy measurement.
Muscimol can establish tonic receptor conductance and a different initial membrane
voltage. Drug-mode first-spike timing uses observation start (t=0), rather than
assuming that the first transmitter release caused every spike.

Every drug-lab run has a matched same-model control with all seven drug
concentrations set to zero. All other settings are retained. Transmitter transport
is unchanged by these postsynaptic drugs, so the exact fields can be shared.
The new kinetic model's drug-free trace is not the legacy two-state trace.

Concentration-response experiments are equilibrium receptor clamps at -65 mV.
They vary free drug or target-agonist concentration and calculate open fraction
and signed membrane-drive current g*(E-Vhold), with no diffusion, membrane
integration or firing. They must not be interpreted as transient synaptic response
curves or as the experimental peak-current EC50 used to inform a model parameter.
Synaptic charge in full runs integrates sampled signed current in pC; reset-adjacent
quadrature error and timestep dependence are explicitly documented.

## Scope and interpretation

Two independent effective synaptic populations (glutamate/AMPA and GABA/GABA-A)
drive one isopotential conductance-based leaky integrate-and-fire neuron. Each
illustrated terminal represents an aggregate input, not a calibrated single
bouton. Aggregate maximal conductances can exceed single-contact values.

The model is deterministic and illustrative. It reports whether and when threshold
is crossed, not firing probability. It is not clinically or experimentally validated.

## Equations and units

Time ms; concentration uM; distance um; voltage mV; capacitance pF; conductance nS.
The units satisfy nS*mV = pA = pF*mV/ms.

Transport: dC/dt = D*d2C/dx2 - k_clear*C + release.
Receptor open-state approximation: dO/dt = kon*C*(1-O) - koff*O.
Conductance: gE = gE_max*AMPA_availability*O_AMPA, likewise for GABA-A.
Membrane: Cm*dV/dt = gL*(EL-V) + gE*(EE-V) + gI*(EI-V).
At threshold, record a spike event, reset V, and hold reset for a refractory interval.

The voltage trace is the LIF voltage, without an artificial positive spike peak.
A plotted threshold marker and animated axon pulse represent the recorded event.
They do not calculate sodium/potassium kinetics or cable propagation.

## Parameter provenance

| Quantity | Value | Status/source |
|---|---:|---|
| AMPA kon | 0.0011 uM^-1 ms^-1 | Destexhe et al. 1998, section 1.4, converted from 1.1e6 M^-1 s^-1 |
| AMPA koff | 0.19 ms^-1 | Same source, 190 s^-1 |
| GABA-A kon | 0.005 uM^-1 ms^-1 | Same source, 5e6 M^-1 s^-1 |
| GABA-A koff | 0.18 ms^-1 | Same source, 180 s^-1 |
| EE, EI | 0, -80 mV | Same source; EI adjustable |
| Glutamate D | 0.32 um^2/ms | Zheng et al. 2008 apparent extracellular estimate, adapted to an effective 1D model |
| GABA D | 0.32 um^2/ms | Illustrative shared coefficient, not a measured GABA estimate |
| Cm, gL | 200 pF, 10 nS | Rounded adaptation of Brian COBA example (198 pF, 9.99 nS) |
| EL, reset, threshold | -65, -65, -50 mV | Illustrative; threshold matches Brian example |
| Refractory period | 2 ms | Illustrative |
| Glutamate clearance | 0.20 ms^-1 | Illustrative first-order rate; isolated removal time constant 5 ms |
| GABA clearance | 0.15 ms^-1 | Illustrative first-order rate; isolated removal time constant 6.67 ms |
| Release, geometry, gmax, relative receptor availability | Configurable | Illustrative, not fitted to a biological specimen |

The names kon and koff denote effective opening and closing rates in Destexhe's
two-state fit to postsynaptic currents. They are not universal microscopic ligand
binding/unbinding constants. O is the model open fraction, not a separate measure
of ligand occupancy. Rate conversion from M^-1 s^-1 to uM^-1 ms^-1 multiplies by
1e-9; conversion from s^-1 to ms^-1 divides by 1000.

Destexhe's individual-contact AMPA gmax examples are approximately 0.35-1 nS;
our aggregate conductance setting must not be interpreted as one such contact.
Parameter bounds protect numerical execution and permit exploratory regimes;
they do not define physiological ranges or establish biological validity for every
accepted combination. Numerical stability also does not guarantee accuracy.

## Numerical implementation

Stage 1: exponentially cleared instantaneous concentration increments in an
effective compartment. Include exact positive-dose release times in the integration
timeline; zero-dose events cannot change the numerical clock.

Stage 2: equal-width cell-centered finite volumes in separate effective 1D
extracellular domains, reflecting boundaries, normalized Gaussian release profile.
Use backward Euler diffusion (SciPy tridiagonal solve) and exact first-order decay.
Mass per unit effective cross-section is sum(C)*dx in uM*um; it is not a molecule
count. No-flux diffusion conserves it, uptake removes it, and release adds it.

Receptors and membrane use bounded/exponential frozen-input updates over short
steps; exact formulas do not remove time discretization error from coupling.
Analytic within-step threshold localization and explicit reset/refractory handling
avoid missed threshold events. Time and spatial refinement quantify errors.

The spatial defaults use a 2 um effective domain with 81 cells, release center
0.4 um, receptor sampling position 0.6 um, and Gaussian standard deviation 0.08 um.
These coordinates describe an effective transport path, not the measured height
of a synaptic cleft. Each neurotransmitter has its own field on this geometry.
The shared coordinate convention does not mix the two transmitters.

Release dose Q is the integrated concentration increment in uM*um. A normalized
Gaussian profile w is constructed so sum(w)*dx=1; a release adds Q*w. The
compartment comparison adds Q/L. Neither interpretation counts individual molecules
without specifying an effective cross-sectional area. The default aggregate doses
are 1000 uM*um for glutamate and 400 uM*um for GABA, released at 10 ms. The default
maximal conductances are 40 and 30 nS respectively. All are illustrative settings.

On the finite-volume grid, the diffusion matrix has reflecting end rows. Backward
Euler solves (I-dt*D*A) C_new=C_old, then uniform uptake multiplies by exp(-k*dt).
The matrix preserves nonnegativity and total mass in exact arithmetic. Numerical
mass checks explicitly compare retained, released and removed dose. Receptor-local
concentration is sampled from the field, rather than inferred from total dose.

The default time step is 0.05 ms. Positive-dose release timestamps are inserted into the clock
exactly. Concentration can jump at a release; receptor occupancy and voltage remain
continuous there. Each interval uses its left concentration, and midpoint receptor
occupancy supplies the frozen membrane conductance. Consequently the coupled scheme
is first-order accurate in general and must be checked by time-step refinement.
At a recorded spike, the voltage resets; the summary includes threshold as an
attained peak even if sampled post-reset voltages fall below it.

Browser and PNG plots break sampled line segments across instantaneous releases
and spikes; separate threshold-to-reset strokes identify exact recorded events.
No pre-event trajectory is inferred across those gaps. Tooltips identify recorded
samples, while the exact event list is exported separately.

Runs and sweeps include a numerical-resolution screen. Active-input clearance*dt
above 0.1, sampled maximum (kon*C+koff)*dt above 0.25, or sampled maximum
(gL+gE+gI)*dt/Cm above 0.25 prompts review and a smaller suggested starting timestep.
These conservative flags are not numerical error bounds. In particular, they do
not assess every diffusion gradient or certify near-threshold outcomes. They do
not change the integrator or supplied resolution. Unflagged sampled concentration
peaks can still need refinement: the default glutamate peak is about 10.6% below
the continuous-time same-grid reference. See SCIENTIFIC_AUDIT.md for the complete
independent comparisons, counterexamples and convergence results.

## Reproducibility

Numerical calculations contain no random draws. Exact settings are serialized with
units in field names and a versioned schema. Outputs record parameter and model
source SHA-256 fingerprints plus Python/NumPy/SciPy versions. Repeating a run in
the pinned environment reproduces the arrays exactly; cross-platform floating-point
implementations can differ at roundoff and near threshold boundaries. A fixed
visualization seed affects only schematic particle placement.

The default spatial configuration uses JSON schema 2. Legacy effective-compartment
configurations retain schema 1 and remain reloadable. Strict validation rejects
unknown, missing, duplicate, nonfinite, and inconsistent settings rather than
silently substituting defaults. Dependency versions are pinned in requirements.txt.
The numerical source fingerprint identifies the normalized text of the Python
modules; it is not a substitute for retaining the corresponding source archive.
It does not identify the browser's JavaScript artwork. Visualization seed 17 is
recorded separately and has no effect on the numerical solution.

## Illustrative experiments

The supplied scenarios use the same equations and default numerical resolution as
manual runs. They are examples chosen to expose mechanisms, not fitted experimental
conditions. Unlisted settings in this table remain at baseline.

| Scenario | Changes from baseline | Spikes over 100 ms |
|---|---|---:|
| Baseline neurotransmission | Glutamate dose 1000, GABA dose 400 uM*um; both at 10 ms; availability 1 | 1 |
| Excitation-dominant input | GABA dose 0 | 3 |
| Inhibition-dominant input | Glutamate dose 500; GABA dose 1200 uM*um | 0 |
| Reduced glutamate clearance | Glutamate clearance 0.04 rather than 0.20 ms^-1 | 12 |
| More functional GABA-A receptors | Relative GABA-A availability 3 | 0 |
| Delayed GABA release | GABA release at 18 rather than 10 ms | 2 |
| Subthreshold excitation | Glutamate dose 50 uM*um; GABA dose 0 | 0 |
| Zero synaptic input | Both doses 0 | 0 |

The baseline first spike occurs at 14.601586 ms, or 4.601586 ms after release.
Excitation alone first spikes at 12.772357 ms. The release-imbalance inhibition
preset peaks at -54.844253 mV. These are reference calculations at dt=0.05 ms and
81 cells; displayed values are rounded and should not imply experimental precision.

Two-parameter sweeps vary glutamate dose along columns and GABA-A relative
availability along rows. Outputs are spike count, peak LIF voltage, and first-spike
latency from the first nonzero-dose release. Silent cells have undefined latency
(JSON null/blank CSV), not zero latency. The algorithm makes no probability claim.

For each dose, the ordinary engine calculates numerical receptor-local transmitter
traces. These traces are reused when only GABA-A availability changes, because
availability affects maximal conductance but not transport or receptor occupancy
in this model. Receptor and membrane equations are integrated at the original
resolution for every cell. Tests compare optimized cells exactly against complete
independent single-run calculations in both spatial and compartment modes,
including repeated off-grid release events.

The API accepts 2-7 strictly increasing finite values per axis (up to 49 cells).
The UI offers square 3x3, 5x5, and 7x7 grids. Numerical work limits reject excessively
expensive requests without silently coarsening dt or the grid. Sweeps retain the
base configuration, explicit axes, source/parameter/axis fingerprints, and a
deterministic sweep identifier. A sweep uses the completed experiment, not pending
changes in the controls.

## Quantitative exports

The completed-run ZIP contains parameters.json, provenance.json, trace.csv,
spikes.csv, numerical_arrays.npz, figure.png, summary.txt, and this model document.
The NPZ retains every numerical time sample and, in spatial mode, x coordinates
and both concentration fields shaped [time, spatial cell]. Trace CSV includes the
full receptor-local and electrical timeline plus retained/released/cleared mass
series. Exact spike timestamps are exported separately from sampled voltage.

CSV headings include units, with dimensionless open fractions explicitly named.
Metadata comment lines begin with # and contain the configuration and provenance.
The parameter JSON reloads the exact settings. Figures show receptor-local
concentrations, open fractions, LIF voltage, threshold, and exact spike markers;
they do not insert a fabricated positive spike waveform. The PNG is exported at
300 dpi. Sweep CSVs contain each pair of axis values and all three metrics, plus
base-configuration/provenance metadata; a sweep PNG uses the selected metric.

Exports use the completed result identified by its run or sweep identifier.
Pending controls do not alter an existing result's data or saved configuration.
The archive includes model documentation and data, not the application source or
dependency installer. Retain the project version for reproducible future execution.

## Validation results

The numerical validation tests include independent analytic reflecting cosine modes, exact
mass decay and release superposition, Gaussian dose normalization, free-diffusion
variance, receptor/voltage solutions, release causality and saved-array regression.
Default maximum mass residuals: glutamate 8.41e-12 and GABA 7.16e-12 uM*um.

Excitation-only temporal refinement preserves three spikes: maximum spike-time
changes are 0.052922 ms for dt 0.1 to 0.05 ms and 0.027051 ms for 0.05 to 0.025 ms.
At dt 0.025 ms, spatial changes are 0.002266 ms from 41 to 81 cells and 0.000536 ms
from 81 to 161 cells. These are numerical verification results for the reference
conditions, not a claim of experimental validation or uniform accuracy everywhere.

Diffusion ratio D*dt/dx^2 is limited to 100000 to avoid extreme matrix conditioning.
A run also stops with an explanatory error if mass residual exceeds
1e-7*max(1,total released dose). Memory use and unresolved source widths are checked
before allocation. Near a firing boundary, refine the timestep before interpreting
a change of spike count as a robust result.

Additional checks cover control-to-model mappings, independent transmitter fields,
GABA reversal-dependent drive, exact configuration replay, preset mechanisms,
optimized sweep equivalence, exported arrays/units/metadata, and preservation of
release boundaries and spike times in the browser adapter. Browser checks exercised
the actual interface with model-produced results, including spiking, silent,
simultaneous-input, reduced-clearance, and altered-timing conditions.

See TEST_REPORT.md for the final test count and execution details. Tests establish
implementation correctness under the tested conditions, not agreement with a
particular biological preparation. The restricted development environment verified
request handlers, rendered browser interactions, and generated download bytes;
normal desktop TCP startup and native browser download completion were not verified
there and remain explicit operational checks.

## Animation interpretation

Playback holds the latest recorded sample rather than interpolating through
release jumps or voltage resets. Readouts can therefore trail the playback clock
by a sampling interval. Exact spike times determine the counter and immediate
refractory reset. Each recorded event starts an illustrative dendrite-to-soma-to-axon
light cascade; its later visual stages are not additional spike events or calculated
conduction delays. In particular, the dendritic lights appear after threshold has
already been crossed, so they do not depict the preceding synaptic integration or
a back-propagating action potential. A delayed browser frame can skip part of a
cascade without altering the recorded events. At 1x speed, 5 ms of model time elapse
per real second; playback is not real-time neuronal propagation.
If a run ends shortly after a spike, playback can end before the whole decorative
cascade is shown; the event remains in the counters, graphs and exported timestamps.

Particles use a fixed seed (17) and inverse-CDF sampling of each calculated
concentration field. One representative symbol corresponds to 15 uM*um of retained
integrated concentration, with at most 100 symbols per input. These are schematic
symbols, not molecule counts or Brownian trajectories. Transverse movement is
illustrative. Sub-symbol concentrations can remain present without a visible
particle. The entire light cascade lasts 3 ms of model time for visibility; the
axon segment occupies only part of that interval. It is not a cable equation
solution. The spatial display may be sampled more coarsely than the full
engine arrays; exported quantitative data retain the numerical timestep.

Channel percentages display O, while receptor availability separately scales
functional activation/conductance. The displayed GABA drive uses gI*(EI-V), so
positive values depolarize and negative values hyperpolarize; this is the signed
contribution to the membrane equation, opposite the outward-positive current
convention. Shunting can occur without an obligatory hyperpolarization.

## Limitations

Two-state receptors omit desensitization and multistate gating. Receptor activation
does not deplete the extracellular bath. First-order clearance represents effective
removal associated with EAAT/GAT uptake, not a measured transporter turnover rate,
transporter saturation, reversible buffering, or explicit transport cycles.
The 1D geometry is not an anatomical cleft reconstruction. A single compartment
omits dendritic filtering, NMDA receptors and intrinsic voltage-gated currents.
GABA current follows EI-V; it may provide a depolarizing or hyperpolarizing drive,
and added conductance can inhibit through shunting. The fixed EI represents an
effective Cl-/HCO3- reversal. Intracellular chloride, KCC2/NKCC1 transport and
activity-dependent changes in reversal are not modeled (Burman et al. 2023).

Reflecting boundaries, illustrative clearance and omitted desensitization permit
longer receptor exposure than an ordinary isolated synaptic-cleft transient.
Reduced-clearance results should not be generalized to the effect of blocking
uptake at every synapse: Zheng et al. (2008) found little effect of perisynaptic
uptake blockade on ordinary synaptic AMPA responses in their preparation.

## References

1. Destexhe A, Mainen ZF, Sejnowski TJ (1998). Kinetic Models of Synaptic Transmission.
   Methods in Neuronal Modeling, 2nd ed. Author text, section 1.4:
   https://papers.cnl.salk.edu/PDFs/Kinetic%20Models%20of%20Synaptic%20Transmission%201998-3229.pdf
2. Zheng K, Scimemi A, Rusakov DA (2008). Receptor actions of synaptically released
   glutamate: the role of transporters on the scale from nanometers to microns.
   https://pmc.ncbi.nlm.nih.gov/articles/PMC2576387/
3. Brian 2 COBA example, Stimberg et al. model:
   https://brian2.readthedocs.io/en/stable/examples/frompapers.Stimberg_et_al_2018.example_1_COBA.html
4. SciPy solve_banded API (implementation tool, not biological validation):
   https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.solve_banded.html
5. Burman RJ et al. (2023). Active cortical networks promote shunting fast synaptic
   inhibition in vivo. Neuron 111:3531-3540.e6. doi:10.1016/j.neuron.2023.08.005.
   https://pmc.ncbi.nlm.nih.gov/articles/PMC11913778/
