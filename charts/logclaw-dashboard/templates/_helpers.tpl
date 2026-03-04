{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-dashboard.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "logclaw-dashboard.fullname" -}}
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
{{- define "logclaw-dashboard.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "logclaw-dashboard.labels" -}}
helm.sh/chart: {{ include "logclaw-dashboard.chart" . }}
{{ include "logclaw-dashboard.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: logclaw
{{- end }}

{{/*
Selector labels
*/}}
{{- define "logclaw-dashboard.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-dashboard.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: dashboard
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "logclaw-dashboard.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "logclaw-dashboard.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Resolve tenantId — required; fail loudly if not provided.
Must be set via global.tenantId in parent chart or --set.
*/}}
{{- define "logclaw-dashboard.tenantId" -}}
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
Resolve opensearchEndpoint — required global value.
*/}}
{{- define "logclaw-dashboard.opensearchEndpoint" -}}
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
Uses Helm release name to match the actual K8s service created by the umbrella chart.
*/}}
{{- define "logclaw-dashboard.otelCollectorEndpoint" -}}
http://{{ .Release.Name }}-logclaw-otel-collector.{{ .Release.Namespace }}.svc:4318
{{- end }}

{{/*
Resolve ticketingEndpoint — LogClaw Ticketing Agent service.
*/}}
{{- define "logclaw-dashboard.ticketingEndpoint" -}}
http://{{ .Release.Name }}-logclaw-ticketing-agent.{{ .Release.Namespace }}.svc:8080
{{- end }}

{{/*
Resolve bridgeEndpoint — LogClaw Bridge service.
*/}}
{{- define "logclaw-dashboard.bridgeEndpoint" -}}
http://{{ .Release.Name }}-logclaw-bridge.{{ .Release.Namespace }}.svc:8080
{{- end }}

{{/*
Resolve feastEndpoint — Feast feature server (ML Engine).
*/}}
{{- define "logclaw-dashboard.feastEndpoint" -}}
http://{{ .Release.Name }}-logclaw-ml-engine-feast-server.{{ .Release.Namespace }}.svc:6567
{{- end }}

{{/*
Resolve airflowEndpoint — Apache Airflow webserver.
*/}}
{{- define "logclaw-dashboard.airflowEndpoint" -}}
http://{{ .Release.Name }}-webserver.{{ .Release.Namespace }}.svc:8080
{{- end }}

{{/*
Resolve agentEndpoint — LogClaw infrastructure health agent.
*/}}
{{- define "logclaw-dashboard.agentEndpoint" -}}
http://{{ .Release.Name }}-logclaw-agent.{{ .Release.Namespace }}.svc:8080
{{- end }}
