FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV ATLAS_STAGING=/data/atlas-tool
ENV PORT=8765
EXPOSE 8765

CMD ["python", "ui_server.py"]
