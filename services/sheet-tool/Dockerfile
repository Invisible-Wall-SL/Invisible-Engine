# Build context = repo root (Railway Root Directory = repo root,
# Dockerfile Path = services/sheet-tool/Dockerfile) so the shared
# services/_shared/iw_common package can be COPY'd into the image.
FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip
COPY services/sheet-tool/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Shared package FIRST (different dir from the app code, so app code can't
# clobber it). Importable as `iw_common.*` via PYTHONPATH=/app below.
COPY services/_shared/iw_common ./iw_common
# App code into /app (its thin storage.py / iw_banner.py shims re-export iw_common).
COPY services/sheet-tool/ .

ENV PYTHONPATH=/app
ENV SHEET_STAGING=/data/sheet-tool
ENV PORT=8766
EXPOSE 8766

CMD ["python", "sheet_server.py"]
