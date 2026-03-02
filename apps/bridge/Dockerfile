FROM python:3.12-slim
LABEL org.opencontainers.image.source="https://github.com/logclaw/logclaw"
LABEL org.opencontainers.image.description="LogClaw Bridge — Kafka→OpenSearch ETL with anomaly detection"
LABEL org.opencontainers.image.licenses="Apache-2.0"
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
USER 1000:1000
EXPOSE 8080
CMD ["python", "main.py"]
