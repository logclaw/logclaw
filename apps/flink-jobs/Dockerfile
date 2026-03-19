# ─────────────────────────────────────────────────────────────
# LogClaw Flink Jobs — multi-stage build
# Stage 1: Maven compile → fat JARs
# Stage 2: Copy JARs into official Flink image
# ─────────────────────────────────────────────────────────────

# Keep in sync with pom.xml <version>
ARG VERSION=2.1.0

# ── Stage 1: Build ──────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-11 AS builder
ARG VERSION

WORKDIR /build

# Cache dependencies first (layer caching optimisation)
COPY pom.xml .
COPY logclaw-etl/pom.xml logclaw-etl/
COPY logclaw-enrichment/pom.xml logclaw-enrichment/
COPY logclaw-anomaly-scorer/pom.xml logclaw-anomaly-scorer/
RUN mvn dependency:go-offline -B -q 2>/dev/null || true

# Copy source and build
COPY . .
RUN mvn clean package -B -q -DskipTests \
    && ls -la logclaw-etl/target/ logclaw-enrichment/target/ logclaw-anomaly-scorer/target/

# ── Stage 2: Runtime ────────────────────────────────────────
FROM flink:1.19-java11
ARG VERSION

# Install GCS Hadoop connector for checkpoint/savepoint storage on GCS
# https://nightlies.apache.org/flink/flink-docs-release-1.19/docs/deployment/filesystems/gcs/
RUN mkdir -p /opt/flink/plugins/gcs-fs \
    && curl -fsSL https://repo1.maven.org/maven2/org/apache/flink/flink-gs-fs-hadoop/1.19.1/flink-gs-fs-hadoop-1.19.1.jar \
       -o /opt/flink/plugins/gcs-fs/flink-gs-fs-hadoop-1.19.1.jar \
    && echo "GCS plugin: $(stat -c%s /opt/flink/plugins/gcs-fs/flink-gs-fs-hadoop-1.19.1.jar 2>/dev/null || stat -f%z /opt/flink/plugins/gcs-fs/flink-gs-fs-hadoop-1.19.1.jar) bytes"

# Copy fat JARs to /opt/flink/jobs/
COPY --from=builder /build/logclaw-etl/target/logclaw-etl-${VERSION}.jar \
                    /opt/flink/jobs/logclaw-etl-${VERSION}.jar

COPY --from=builder /build/logclaw-enrichment/target/logclaw-enrichment-${VERSION}.jar \
                    /opt/flink/jobs/logclaw-enrichment-${VERSION}.jar

COPY --from=builder /build/logclaw-anomaly-scorer/target/logclaw-anomaly-scorer-${VERSION}.jar \
                    /opt/flink/jobs/logclaw-anomaly-scorer-${VERSION}.jar

# Verify JARs are not empty
RUN for jar in /opt/flink/jobs/*.jar; do \
      echo "Checking $jar: $(stat -c%s "$jar" 2>/dev/null || stat -f%z "$jar") bytes"; \
      java -jar "$jar" --version 2>/dev/null || true; \
    done

USER flink
