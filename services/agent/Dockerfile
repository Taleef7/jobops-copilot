FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt requirements-rag.txt ./
# Install the CPU-only torch wheel first so sentence-transformers reuses it.
# Container Apps (consumption) has no GPU, so the default CUDA build would just
# bloat the image by ~4 GB and waste memory for no functional gain.
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && pip install --index-url https://download.pytorch.org/whl/cpu torch \
    && pip install -r requirements-rag.txt

COPY app ./app

EXPOSE 8000

# Azure App Service / Container Apps inject PORT; default to 8000 locally.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
