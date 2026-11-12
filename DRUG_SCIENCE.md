# SynaptiCob pharmacology: evidence and interpretation

## What the classroom model represents

The drug module is a literature-informed educational receptor model coupled to
the existing extracellular transport and conductance-based leaky integrate-and-fire
neuron. It is not a calibrated human neuron, a clinical dose calculator, or a
prediction of whole-brain, behavioral, anticonvulsant, or toxic effects.

Drug concentrations represent free concentrations at the receptor in a constant
bath, not tablet doses, plasma concentrations, or administered amounts. Drugs are
present before the transmitter experiment. Onset, wash-in, absorption, metabolism,
protein binding and washout are outside this version's scope. This distinction is
particularly important for perampanel, whose measured receptor-block onset is
on the order of seconds, longer than the default 100-ms transmitter experiment.

The receptor populations are reduced teaching approximations. They combine
mechanisms demonstrated in particular preparations; they are not one jointly
fitted receptor-subtype dataset. Source-specific values and model assumptions
must remain identifiable. An allosteric drug's functional concentration-response
fraction is not automatically its molecular binding occupancy.

## The seven compounds

| Compound | Represented mechanism | Important qualification |
|---|---|---|
| CX614 | Positive AMPA modulation through slower channel closing and enhanced recovery from desensitization | Research compound. Requires glutamate in the modeled system; it is not an additional glutamate release. |
| NBQX | Competitive AMPA-site antagonism | Research compound. Also targets kainate receptors, which are not represented. Equilibrium competition and transient pulse competition are different experiments. |
| Perampanel | Negative allosteric AMPA modulation | Fractional functional inhibition is represented. It is not an open-pore blocker, and it is not exclusively AMPA-selective in all preparations. |
| Diazepam | Positive modulation at the GABA-A benzodiazepine site | Represents a benzodiazepine-sensitive alpha/beta/gamma population. The usual GABA-dependent teaching case does not cover constitutively active mutants or every receptor subtype. |
| Gabazine (SR95531) | Competitive GABA-site antagonism | Research compound. Blocking inhibition can increase the modeled neuron's firing; an antagonist is not necessarily a neuronal suppressant. |
| Muscimol | Direct GABA-A agonism | Research compound. Can activate the modeled receptor without synaptic GABA release. Its effect is not mediated by increasing release. |
| Flumazenil | Competition with diazepam at the benzodiazepine site | Modeled as neutral at that site. It does not remove GABA or generally block GABA-A conductance. Partial efficacy at other subtypes and clinical withdrawal are outside scope. |

GABA-A activation changes conductance toward the configured reversal potential.
The default -80 mV setting supports inhibitory/hyperpolarizing or shunting effects;
changing this reversal potential can change the electrical interpretation. A drug
must not be assigned a hard-coded number of spikes or a universal excitation sign.

## Primary evidence and numerical anchors

The numbers below are evidence anchors, not interchangeable measurements. The
implementation parameter table below identifies how anchors are adapted.

| Source | Preparation and measurement | Relevant result |
|---|---|---|
| Mitchell & Fleck, 2007 [1], Table 2 | Recombinant GluR1 AMPA receptors; fitted multistate kinetic scheme | Control association 20 per micromolar per second; dissociation 9000 per second; opening 8000 per second; closing 1550 per second; desensitization 1800 per second; recovery 7.6 per second. CX614 condition: closing 500 per second, recovery 38 per second. |
| Arai et al., 2000 [2] | Hippocampal synaptic responses and recombinant AMPA receptors | CX614 functional EC50 values around 20-40 micromolar for synaptic enhancement; desensitization-block EC50 44 micromolar. Subunit/splice variant affects the result. |
| Randle et al., 1992 [3] | Rat cortex mRNA expressed in Xenopus oocytes; AMPA currents | NBQX apparent antagonist Ki 0.063 micromolar; Schild analysis supported competitive inhibition. Hippocampal field-response IC50 was 0.90 micromolar, illustrating assay dependence. |
| Chen et al., 2014 [4] | Cultured rat hippocampal neurons; AMPA receptor currents evoked with kainate | Perampanel functional IC50 0.56 micromolar; onset approximately 1 second at 3 micromolar. Agonist concentration did not appreciably overcome this block in that protocol. |
| Gielen et al., 2012 [5] | Recombinant alpha1-beta2-gamma2 GABA-A receptors in Xenopus oocytes | A binding/preactivation/opening equilibrium model reproduced diazepam potentiation with approximately fourfold increased preactivation equilibrium. This paper does not establish unique microscopic kinetic rate constants. |
| Li et al., 2013 [6] | Recombinant alpha1-beta2-gamma2 receptors; whole-cell and single-channel recordings | Diazepam functional potentiation EC50 about 25 nM for GABA-activated responses. Gating effects cannot be reduced to a universally valid 'increased opening frequency' rule. |
| Rijal & Gross, 2008 [7] | Murine cortical networks on microelectrode arrays; muscimol titrations | Gabazine Schild antagonist constant KB 0.23 micromolar. This is a functional antagonist estimate, not a direct microscopic binding measurement. |
| Mortensen et al., 2010 [8] | Recombinant alpha1-beta3-gamma2 receptors | Muscimol was a full agonist in this preparation, with functional EC50 about 0.92 micromolar versus about 3.4 micromolar for GABA. These are not ligand dissociation constants. |
| Zhu et al., 2018 [9], Extended Data Figure 2 | Purified human alpha1-beta2-gamma2 structural construct | Flumazenil radioligand Kd 7.7 nM used in competition analysis. Functional recordings demonstrate reversal of diazepam potentiation. A purified construct is not a universal neuronal preparation. |
| Bianchi et al., 2009 [12], Figure 1 | Reduced four-state GABA-A model; accompanying alpha1-beta3-gamma2L patch-clamp experiments | Association 5e6 M^-1 second^-1; dissociation 1000 per second; opening 800 per second; closing 500 per second; desensitization 800 per second; recovery 100 per second. Slower unbinding modeled diazepam-dependent response prolongation. |

In [1], per-second rates convert to per-millisecond rates by division by 1000.
The association rate 20 micromolar^-1 second^-1 becomes 0.020 micromolar^-1
millisecond^-1. Reducing the published topology while retaining selected rates
does not reproduce the original fitted model and must be described as a model
reduction, rather than a direct reproduction of that paper's results.

Gielen et al. explicitly discuss the non-identifiability of separate GABA binding
and preactivation equilibrium constants from the concentration-response data.
For one scenario their K, F and E are 33.6 mM, 31.9 and 5.84; other scenarios can
fit the data with different K and F. A chosen activation timescale added to this
equilibrium structure is a modeling assumption, not a measured rate from [5].

## Implemented reduced parameterization: classroom-receptors-v1

At time zero the receptors are equilibrated with the drug bath and no released
transmitter. A transmitter release scheduled at zero is still a new event, not
part of the pre-equilibration. The initial membrane voltage is the conductance-
weighted tonic equilibrium of leak and muscimol-activated GABA-A conductance.
If that equilibrium lies at or above threshold, the simulation starts instead
at the reset phase and records this special initialization in its metadata.
It does not present an unstable suprathreshold voltage as a resting state.

Both receptor families use a resting closed pool R, an agonist-bound closed
state B, an open state O, and a desensitized state D. The transitions are
R <-> B, B <-> O and B <-> D. The GABA-A population adds a parallel
muscimol-bound B/O/D branch sharing the same resting pool. The branch labels
distinguish agonist binding from channel opening; they do not enumerate the
two physical GABA sites or four AMPA subunits.

| Rate | AMPA | GABA-A | Units |
|---|---:|---:|---|
| Agonist association | 0.020 | 0.005 | micromolar^-1 ms^-1 |
| Agonist dissociation | 9.0 | 1.0 | ms^-1 |
| Channel opening | 8.0 | 0.8 | ms^-1 |
| Channel closing | 1.55 | 0.5 | ms^-1 |
| Desensitization entry | 1.8 | 0.8 | ms^-1 |
| Desensitization recovery | 0.0076 | 0.1 | ms^-1 |

The AMPA values are selected from [1] in a reduced topology. The GABA-A values
and four-state topology follow the pedagogical model in [12]. The latter paper
itself did not claim an absolute quantitative fit of all macroscopic drug effects.
The extra muscimol branch and combinations are extensions in SynaptiCob.

### Competitive antagonists

The fraction of the pooled resting state immediately accessible to agonist is
`q = 1 / (1 + antagonist_concentration / antagonist_scale)`.
NBQX uses 0.063 micromolar and gabazine uses 0.23 micromolar [3,7]. Agonist
association is multiplied by q. This is a rapid-equilibrium approximation:
drug-free R contributes `R*q`, and the estimated antagonist-associated closed
fraction is `R*(1-q)`. Counting both the whole R pool and its antagonist-associated
part as independent populations would double count receptors.

This implementation preserves competitive equilibrium displacement without
inventing independently measured antagonist association/dissociation rates.
It does not reproduce slow antagonist dissociation during a millisecond pulse.
The estimated antagonist-associated fractions are model predictions under this
assumption, not measured biological occupancy.

### CX614

Use the functional interpolation `f = concentration / (30 + concentration)`,
with concentrations in micromolar. The 30-micromolar scale is the midpoint of
the approximately 20-40-micromolar functional range reported in [2], not a Kd.
At 100 micromolar, channel closing is calibrated to 0.5 ms^-1 and recovery to
0.038 ms^-1, the CX614 values from [1]. The interpolations are
`closing = 1.55 / (1 + 2.73*f)` and
`recovery = 0.0076 * (1 + 5.2*f)`.
The intervening curve and extrapolation are explicit teaching assumptions,
not a new fit to raw experimental data. f is an effect weight, not occupancy.

### Perampanel

The retained AMPA functional response is
`1 / (1 + concentration / 0.56)` using micromolar units [4]. This factor scales
the conducting population's contribution to current after activation is solved.
The complementary fraction is labeled fractional functional inhibition, not
drug-site occupancy. A unit Hill slope and applying this assay-derived curve
to the reduced AMPA population are modeling assumptions. Drug onset is not
simulated, and this implementation does not insert a pore-blocked state.

### Muscimol

The muscimol branch has the same gating/desensitization constants as the GABA
branch, and an association coefficient of `0.005 * (3.4 / 0.92)` micromolar^-1
ms^-1. Its dissociation coefficient is initially 1.0 ms^-1. This makes muscimol
approximately 3.70 times as potent as GABA in the model's equilibrium response,
using the relative functional potency from [8]. It does **not** assert that
microscopic muscimol association was measured to be 3.70 times faster, nor that
the model reproduces the absolute 0.92-micromolar experimental EC50.
Shared branch efficacy is a full-agonist teaching approximation.

### Diazepam and flumazenil

Define operational weights `z = diazepam_uM / 0.025` and
`f = flumazenil_uM / 0.0077`, and a diazepam effect weight
`w = z / (1 + z + f)` [6,9]. The diazepam scale is functional whereas the
flumazenil anchor is a binding measurement; using them together in this
competition expression is an explicit operational approximation. w must not
be reported as experimentally calibrated benzodiazepine-site occupancy.

The effective agonist dissociation rate becomes `1 / (1 + 3*w)` ms^-1, while
channel opening remains 0.8 ms^-1. Slower effective unbinding follows the
reduced-model approach in [12]; the maximum fourfold slowdown and concentration
interpolation are chosen teaching parameters. Applying the same slowdown to
the muscimol branch is an agonist-general approximation. This approach preserves
the saturated limiting response and prolongs agonist-evoked currents. It is not
a unique molecular explanation: preactivation and gating models [5,6] provide
alternative explanations in other preparations.

Flumazenil alone has no gating effect in this model, and increasing flumazenil
reduces the diazepam effect weight. This illustrates same-site competition
without implying that flumazenil reverses every GABA-A drug or blocks GABA.

### Equilibrium plots versus transient responses

Concentration-response plots show the stated model endpoint. Equilibrium open
fraction is not peak synaptic current. The control reduced GABA-A model has
limiting equilibrium open fraction `1.6 / 10.6`, and GABA half-maximum
concentration `(1 / 0.005) / 10.6`, approximately 18.9 micromolar. Muscimol's
corresponding concentration is approximately 5.11 micromolar. These derived
model values differ from [8]'s measured peak-response values; the relative
potency ratio is the feature retained. The same distinction applies to the
reduced AMPA topology, especially because its desensitized states accumulate
during a maintained concentration.

## Reading the measurements

- **Kd/Ki/KB:** affinity or antagonist constants, with the assay and derivation
  explicitly identified. These are not always directly measured binding values.
- **EC50/IC50:** concentration giving half of a defined functional effect under
  a specified protocol. They depend on agonist concentration, receptor subtype,
  application duration, endpoint and experimental system.
- **Drug-site occupancy:** a model state or binding-model prediction. It must
  not be inferred from an inhibition curve and labeled experimentally measured.
- **Open fraction:** the fraction in conducting receptor states; a bound receptor
  can be closed, open, or desensitized.
- **Efficacy:** the attainable effect in the stated model or experiment; stronger
  affinity is not automatically a larger maximal response.
- **Charge:** time-integrated modeled synaptic current. The displayed convention
  must identify whether current is membrane-drive or outward-positive; positive
  membrane-drive current is depolarizing.

For equilibrium concentration-response plots, a reversible competitive antagonist
should shift agonist responses rightward without removing the limiting response
at sufficiently high agonist concentration. That statement is not a guarantee
that one brief transmitter pulse will displace a slowly dissociating antagonist.
A noncompetitive functional inhibition model reduces the limiting response.
Positive modulators alter gating or response duration rather than creating
transmitter molecules or more receptors.

## Verification requirements

The implementation should verify probability normalization and nonnegative states;
zero-drug recovery of the selected kinetic baseline; absence of direct activation
by CX614 or diazepam without an agonist in the teaching model; direct activation
by muscimol; gabazine/NBQX competition; perampanel's reduced limiting response;
CX614 response prolongation; and concentration-dependent flumazenil reversal
without a baseline GABA block. Combined drugs must use the same declared mechanism
as individual drugs. Time-step refinement must be checked for receptor currents
and spike decisions, including near-threshold cases.

Comparisons use identical transmitter, membrane, transport and receptor settings,
with drugs removed from the reference run. A no-drug comparison in the new kinetic
mode is not the old two-state model. The original two-state reference calculations
remain separately reproducible.

An independent implementation check compared 24 uniformization updates with
SciPy's dense matrix exponential at timesteps 0.001, 0.05 and 1 ms, and receptor
concentrations 0, 0.1, 1000 and 50,000 micromolar. The maximum state-probability
difference was 4.44e-15; normalization and nonnegativity checks passed. Analytic
equilibrium checks verified the GABA ceiling/half-maximum, source-rate endpoints
at 100 micromolar CX614, preserved saturated GABA response with diazepam, 50%
functional response at 0.56 micromolar perampanel, and direct muscimol activation
without released GABA. These checks verify the stated reduced equations, not
experimental calibration or accuracy of every time-dependent neuron outcome.

## References

1. Mitchell NA, Fleck MW. Targeting AMPA receptor gating processes with allosteric
   modulators and mutations. *Biophysical Journal*. 2007;92:2392-2402.
   https://pmc.ncbi.nlm.nih.gov/articles/PMC1864835/
2. Arai AC, Kessler M, Rogers G, Lynch G. Effects of the potent ampakine CX614 on
   hippocampal and recombinant AMPA receptors. *Molecular Pharmacology*.
   2000;58:802-813. https://pubmed.ncbi.nlm.nih.gov/10999951/
3. Randle JC et al. Competitive inhibition by NBQX of kainate/AMPA receptor
   currents and excitatory synaptic potentials. *European Journal of Pharmacology*.
   1992;215:237-244. https://pubmed.ncbi.nlm.nih.gov/1382998/
4. Chen CY et al. Perampanel inhibition of AMPA receptor currents in cultured
   hippocampal neurons. *PLoS ONE*. 2014;9:e108021.
   https://pmc.ncbi.nlm.nih.gov/articles/PMC4168215/
5. Gielen MC, Lumb MJ, Smart TG. Benzodiazepines modulate GABA-A receptors by
   regulating the preactivation step after GABA binding. *Journal of Neuroscience*.
   2012;32:5707-5715. https://pmc.ncbi.nlm.nih.gov/articles/PMC6703631/
6. Li P et al. The benzodiazepine diazepam potentiates responses of alpha1-beta2-gamma2
   GABA-A receptors activated by either GABA or allosteric agonists. *Anesthesiology*.
   2013. https://pmc.ncbi.nlm.nih.gov/articles/PMC3852889/
7. Rijal SO, Gross GW. Dissociation constants for GABA-A receptor antagonists
   determined with neuronal networks on microelectrode arrays. *Journal of
   Neuroscience Methods*. 2008;173:183-192.
   https://pubmed.ncbi.nlm.nih.gov/18590768/
8. Mortensen M et al. Distinct activities of GABA agonists at synaptic- and
   extrasynaptic-type GABA-A receptors. *Journal of Physiology*. 2010.
   https://pmc.ncbi.nlm.nih.gov/articles/PMC2872731/
9. Zhu S et al. Structure of a human synaptic GABA-A receptor. *Nature*.
   2018;559:67-72. https://pmc.ncbi.nlm.nih.gov/articles/PMC6220708/
10. Deng L, Chen G. Cyclothiazide potently inhibits GABA-A receptors in addition
    to enhancing glutamate responses. *PNAS*. 2003;100:13025-13029.
    https://pmc.ncbi.nlm.nih.gov/articles/PMC240738/
11. Taniguchi S, Stolz JR, Swanson GT. The antiseizure drug perampanel is a
    subunit-selective negative allosteric modulator of kainate receptors.
    *Journal of Neuroscience*. 2022;42:5499-5509.
    https://pmc.ncbi.nlm.nih.gov/articles/PMC9295835/
12. Bianchi MT, Botzolakis EJ, Lagrange AH, Macdonald RL. Benzodiazepine modulation
    of GABA-A receptor opening frequency depends on activation context: a patch
    clamp and simulation study. *Epilepsy Research*. 2009;85:212-220.
    https://pmc.ncbi.nlm.nih.gov/articles/PMC2834588/

Cyclothiazide was excluded from the initial set because its GABA-A inhibition
would confound a simple AMPA-enhancement lesson [10]. The omission of kainate
receptors also limits the representation of perampanel and NBQX [3,11].
