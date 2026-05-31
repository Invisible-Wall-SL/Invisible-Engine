# Build context = repo root (Railway Root Directory = repo root,
# Dockerfile Path = services/atlas-tool/Dockerfile) so the shared
# services/_shared/iw_common package can be COPY'd into the image.
FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip
COPY services/atlas-tool/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Shared package FIRST (different dir from the app code, so app code can't
# clobber it). Importable as `iw_common.*` via PYTHONPATH=/app below.
COPY services/_shared/iw_common ./iw_common
# App code into /app (its thin storage.py / iw_banner.py shims re-export iw_common).
COPY services/atlas-tool/ .

ENV PYTHONPATH=/app
ENV ATLAS_STAGING=/data/atlas-tool
ENV PORT=8765
EXPOSE 8765

CMD ["python", "ui_server.py"]
