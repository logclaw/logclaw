{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-console.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "logclaw-console.fullname" -}}
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
{{- define "logclaw-console.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "logclaw-console.labels" -}}
helm.sh/chart: {{ include "logclaw-console.chart" . }}
{{ include "logclaw-console.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: logclaw
{{- end }}

{{/*
Selector labels
*/}}
{{- define "logclaw-console.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-console.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: console
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "logclaw-console.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "logclaw-console.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Resolve opensearchEndpoint — required global value.
*/}}
{{- define "logclaw-console.opensearchEndpoint" -}}
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
Resolve otelCollectorEndpoint — OTel Collector OTLP HTTP ingestion service.
*/}}
{{- define "logclaw-console.otelCollectorEndpoint" -}}
http://{{ .Release.Name }}-logclaw-otel-collector.{{ .Release.Namespace }}.svc:4318
{{- end }}

{{/*
Resolve ticketingEndpoint — LogClaw Ticketing Agent service.
*/}}
{{- define "logclaw-console.ticketingEndpoint" -}}
http://{{ .Release.Name }}-logclaw-ticketing-agent.{{ .Release.Namespace }}.svc:8080
{{- end }}

{{/*
Resolve bridgeEndpoint — LogClaw Bridge service.
*/}}
{{- define "logclaw-console.bridgeEndpoint" -}}
http://{{ .Release.Name }}-logclaw-bridge.{{ .Release.Namespace }}.svc:8080
{{- end }}

{{/*
Resolve logclawTenantId — tenant ID for dogfooding OTEL logs.
Defaults to "logclaw" when global.logclawTenantId is not set.
*/}}
{{- define "logclaw-console.logclawTenantId" -}}
{{- if .Values.global -}}
  {{- .Values.global.logclawTenantId | default "logclaw" -}}
{{- else -}}
  {{- "logclaw" -}}
{{- end -}}
{{- end }}

{{/*
Name of the console secrets K8s secret (from values.secretName).
*/}}
{{- define "logclaw-console.secretName" -}}
{{ .Values.secretName | default (printf "%s-secrets" (include "logclaw-console.fullname" .)) }}
{{- end }}
