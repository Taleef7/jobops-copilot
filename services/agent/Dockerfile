# Base pinned by digest for reproducible builds (#168) — tracks python:3.12-slim.
# Update the digest deliberately (re-pull python:3.12-slim, `docker inspect`), not silently.
FROM python:3.12-slim@sha256:57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# constraints.txt fully pins the resolved dependency graph (generated from a real build's
# `pip freeze`); the ranged requirements*.txt stay loose for dev ergonomics. Applying it
# with `-c` makes `docker build` reproduce the exact same versions every time.
COPY requirements.txt requirements-rag.txt constraints.txt ./
# pip itself is intentionally NOT upgraded — the version bundled in the digest-pinned
# base (pip 25.0.1) is fixed, so historical rebuilds get the same resolver behavior.
# torch is the CPU-only wheel, installed so sentence-transformers reuses it: Container
# Apps (consumption) has no GPU, so the default CUDA build would just bloat the image by
# ~4 GB for no functional gain. All versions are pinned via constraints.txt.
RUN pip install -r requirements.txt -c constraints.txt \
    && pip install --index-url https://download.pytorch.org/whl/cpu torch==2.13.0+cpu \
    && pip install -r requirements-rag.txt -c constraints.txt \
    # Patch the base image's setuptools (78.1.0) past PYSEC-2025-49 / PYSEC-2026-3447;
    # pinned to match constraints.txt so the fix is itself reproducible.
    && pip install --upgrade "setuptools==83.0.0"

# Stamp the build commit into the image so /health can report it and the
# agent-drift-check workflow can detect a stale (un-activated) deployment.
# Placed after the pip layers so a new SHA never busts the expensive install cache.
ARG GIT_SHA=unknown
ENV AGENT_BUILD_SHA=$GIT_SHA

COPY app ./app

EXPOSE 8000

# Azure App Service / Container Apps inject PORT; default to 8000 locally.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
