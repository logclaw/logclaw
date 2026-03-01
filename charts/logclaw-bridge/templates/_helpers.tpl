{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-bridge.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "logclaw-bridge.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "logclaw-bridge.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "logclaw-bridge.labels" -}}
helm.sh/chart: {{ include "logclaw-bridge.chart" . }}
{{ include "logclaw-bridge.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: logclaw
{{- end }}

{{/*
Selector labels
*/}}
{{- define "logclaw-bridge.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-bridge.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: bridge
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "logclaw-bridge.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "logclaw-bridge.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Resolve tenantId — required; fail loudly if not provided.
Must be set via global.tenantId in parent chart or --set.
*/}}
{{- define "logclaw-bridge.tenantId" -}}
{{- if .Values.global -}}
  {{- if .Values.global.tenantId -}}
    {{- .Values.global.tenantId -}}
  {{- else -}}
    {{- fail "global.tenantId is required and must not be empty. Set it with --set global.tenantId=<your-tenant-id>" -}}
  {{- end -}}
{{- else -}}
  {{- fail "global.tenantId is required and must not be empty. Set it with --set global.tenantId=<your-tenant-id>" -}}
{{- end -}}
{{- end }}

{{/*
Resolve kafkaBrokers — required global value.
*/}}
{{- define "logclaw-bridge.kafkaBrokers" -}}
{{- if .Values.global -}}
  {{- if .Values.global.kafkaBrokers -}}
    {{- .Values.global.kafkaBrokers -}}
  {{- else -}}
    {{- fail "global.kafkaBrokers is required and must not be empty." -}}
  {{- end -}}
{{- else -}}
  {{- fail "global.kafkaBrokers is required and must not be empty." -}}
{{- end -}}
{{- end }}

{{/*
Resolve opensearchEndpoint — required global value.
*/}}
{{- define "logclaw-bridge.opensearchEndpoint" -}}
{{- if .Values.global -}}
  {{- if .Values.global.opensearchEndpoint -}}
    {{- .Values.global.opensearchEndpoint -}}
  {{- else -}}
    {{- fail "global.opensearchEndpoint is required and must not be empty." -}}
  {{- end -}}
{{- else -}}
  {{- fail "global.opensearchEndpoint is required and must not be empty." -}}
{{- end -}}
{{- end }}

{{/*
Resolve raw-logs Kafka topic.
*/}}
{{- define "logclaw-bridge.kafkaTopicRaw" -}}
{{- if .Values.global -}}
  {{- if .Values.global.kafkaTopics -}}
    {{- .Values.global.kafkaTopics.rawLogs | default "raw-logs" -}}
  {{- else -}}
    {{- "raw-logs" -}}
  {{- end -}}
{{- else -}}
  {{- "raw-logs" -}}
{{- end -}}
{{- end }}

{{/*
Resolve enriched-logs Kafka topic.
*/}}
{{- define "logclaw-bridge.kafkaTopicEnriched" -}}
{{- if .Values.global -}}
  {{- if .Values.global.kafkaTopics -}}
    {{- .Values.global.kafkaTopics.enriched | default "enriched-logs" -}}
  {{- else -}}
    {{- "enriched-logs" -}}
  {{- end -}}
{{- else -}}
  {{- "enriched-logs" -}}
{{- end -}}
{{- end }}

{{/*
Resolve anomaly-events Kafka topic.
*/}}
{{- define "logclaw-bridge.kafkaTopicAnomalies" -}}
{{- if .Values.global -}}
  {{- if .Values.global.kafkaTopics -}}
    {{- .Values.global.kafkaTopics.anomalies | default "anomaly-events" -}}
  {{- else -}}
    {{- "anomaly-events" -}}
  {{- end -}}
{{- else -}}
  {{- "anomaly-events" -}}
{{- end -}}
{{- end }}

{{/*
Topology spread key — defaults to topology.kubernetes.io/zone if not set.
*/}}
{{- define "logclaw-bridge.topologyKey" -}}
{{- if .Values.global -}}
  {{- default "topology.kubernetes.io/zone" .Values.global.topologyKey -}}
{{- else -}}
  {{- "topology.kubernetes.io/zone" -}}
{{- end -}}
{{- end }}

{{/*
Name of the ConfigMap that carries the application code.
*/}}
{{- define "logclaw-bridge.configMapName" -}}
{{- printf "%s-app" (include "logclaw-bridge.fullname" .) }}
{{- end }}
