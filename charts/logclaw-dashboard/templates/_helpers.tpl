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
Resolve vectorEndpoint — Vector log ingestion service.
*/}}
{{- define "logclaw-dashboard.vectorEndpoint" -}}
{{- $tenantId := include "logclaw-dashboard.tenantId" . -}}
http://logclaw-ingestion-{{ $tenantId }}.{{ .Release.Namespace }}.svc:8080
{{- end }}

{{/*
Resolve ticketingEndpoint — LogClaw Ticketing Agent service.
*/}}
{{- define "logclaw-dashboard.ticketingEndpoint" -}}
{{- $tenantId := include "logclaw-dashboard.tenantId" . -}}
http://logclaw-ticketing-agent-{{ $tenantId }}.{{ .Release.Namespace }}.svc:8080
{{- end }}

{{/*
Resolve zammadEndpoint — Zammad ITSM service.
*/}}
{{- define "logclaw-dashboard.zammadEndpoint" -}}
{{- $tenantId := include "logclaw-dashboard.tenantId" . -}}
http://logclaw-zammad-{{ $tenantId }}-zammad.{{ .Release.Namespace }}.svc:3000
{{- end }}

{{/*
Resolve bridgeEndpoint — LogClaw Bridge service.
*/}}
{{- define "logclaw-dashboard.bridgeEndpoint" -}}
{{- $tenantId := include "logclaw-dashboard.tenantId" . -}}
http://logclaw-bridge-{{ $tenantId }}.{{ .Release.Namespace }}.svc:8080
{{- end }}

{{/*
Resolve feastEndpoint — Feast feature server (ML Engine).
*/}}
{{- define "logclaw-dashboard.feastEndpoint" -}}
{{- $tenantId := include "logclaw-dashboard.tenantId" . -}}
http://logclaw-ml-engine-{{ $tenantId }}-feast-server.{{ .Release.Namespace }}.svc:6567
{{- end }}

{{/*
Resolve airflowEndpoint — Apache Airflow webserver.
*/}}
{{- define "logclaw-dashboard.airflowEndpoint" -}}
{{- $tenantId := include "logclaw-dashboard.tenantId" . -}}
http://logclaw-airflow-{{ $tenantId }}-webserver.{{ .Release.Namespace }}.svc:8080
{{- end }}
