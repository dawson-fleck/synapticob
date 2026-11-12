FROM python:3.12.16-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/tmp/synapticob-matplotlib \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    PORT=10000

WORKDIR /app
COPY requirements.txt requirements-hosted.txt ./
RUN python -m pip install --no-cache-dir --only-binary=:all: -r requirements-hosted.txt \
    && python -m pip check \
    && useradd --create-home --uid 10001 appuser

COPY neurochemsim/ ./neurochemsim/
COPY ui/ ./ui/
COPY hosted_app.py hosted_storage.py gunicorn.conf.py SCIENTIFIC_MODEL.md DRUG_SCIENCE.md ./

USER appuser
EXPOSE 10000
CMD ["python", "-m", "gunicorn", "--config", "gunicorn.conf.py", "hosted_app:application"]
