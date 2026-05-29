FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV SHEET_STAGING=/data/sheet-tool
ENV PORT=8766
EXPOSE 8766

CMD ["python", "sheet_server.py"]
