# SynaptiCob

An Interactive Neuroscience Simulation Laboratory

Explore glutamate/AMPA and GABA/GABA-A signaling, membrane voltage and spike events,
including seven classroom drug models, matched controls, scientific graphs and
reproducible experiment exports. The website uses the same Python model as the
local application. No student account or software installation is required.

## Publish the website

[Deploy SynaptiCob on Render](https://render.com/deploy?repo=https://github.com/dawson-fleck/synapticob)

The included `render.yaml` selects a **free pilot** with no paid upgrade selected.
Sign in to Render, review the service and create the Blueprint. Render builds the
Docker image and assigns the website its own HTTPS address. Share that returned
address with students after the live smoke check succeeds. The GitHub repository
address is source code, not the running website.

The free service sleeps after inactivity, so an initial visit may take about a
minute to wake it. Run a classroom-size trial before relying on the free plan for
a live lesson. An always-on plan can be selected later after its cost is approved.

## Student directions

Open the SynaptiCob website link in your browser. Choose a scenario, click **Run
experiment**, then **Play**. Use **Drug lab** for drug lessons and **Results** to
view graphs or **Save experiment**. Save your work before leaving the site; online
results are temporary.

## Scientific and operational details

- [Scientific model](SCIENTIFIC_MODEL.md) and [drug evidence and assumptions](DRUG_SCIENCE.md).
- [Hosting configuration and limits](HOSTING.md).
- [Verification status](WEB_VERIFICATION.md).

The model is educational, with explicitly documented reduced-model assumptions.
It does not predict drug doses or clinical outcomes for individual patients.
