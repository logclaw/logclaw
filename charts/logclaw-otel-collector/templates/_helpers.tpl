{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-otel-collector.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "logclaw-otel-collector.fullname" -}}
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
{{- define "logclaw-otel-collector.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "logclaw-otel-collector.labels" -}}
helm.sh/chart: {{ include "logclaw-otel-collector.chart" . }}
{{ include "logclaw-otel-collector.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: logclaw
{{- end }}

{{/*
Selector labels
*/}}
{{- define "logclaw-otel-collector.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-otel-collector.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: otel-collector
logclaw.io/component: otel-collector
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "logclaw-otel-collector.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "logclaw-otel-collector.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Resolve tenantId — required; fail loudly if not provided.
*/}}
{{- define "logclaw-otel-collector.tenantId" -}}
{{- if .Values.global -}}
  {{- if .Values.global.tenantId -}}
    {{- .Values.global.tenantId -}}
  {{- else -}}
    {{- fail "global.tenantId is required and must not be empty." -}}
  {{- end -}}
{{- else -}}
  {{- fail "global.tenantId is required and must not be empty." -}}
{{- end -}}
{{- end }}

{{/*
Resolve kafkaBrokers — required global value.
*/}}
{{- define "logclaw-otel-collector.kafkaBrokers" -}}
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
Resolve raw-logs Kafka topic.
*/}}
{{- define "logclaw-otel-collector.kafkaTopicRaw" -}}
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
