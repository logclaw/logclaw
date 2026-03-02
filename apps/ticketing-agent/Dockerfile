FROM python:3.12-slim

# System deps for snappy compression
RUN apt-get update && \
    apt-get install -y --no-install-recommends libsnappy-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .

USER 1000:1000
EXPOSE 8080
CMD ["python", "-u", "main.py"]
