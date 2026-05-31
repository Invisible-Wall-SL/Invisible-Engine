# Build context = repo root (Railway Root Directory = repo root,
# Dockerfile Path = services/atlas-backend/Dockerfile) so the shared
# services/_shared/iw_common package can be COPY'd into the image.
FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip
COPY services/atlas-backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Shared package FIRST (different dir from the app code, so app code can't
# clobber it). Importable as `iw_common.*` via PYTHONPATH=/app below.
COPY services/_shared/iw_common ./iw_common
# App code into /app (comfy + r2 now resolve to iw_common.comfy / iw_common.storage).
COPY services/atlas-backend/ .

ENV PYTHONPATH=/app
ENV PORT=8000
EXPOSE 8000

CMD ["sh","-c","uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
