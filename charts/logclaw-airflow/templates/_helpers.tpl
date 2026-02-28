{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-airflow.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec). If release name contains chart name it will be used
as a full name.
*/}}
{{- define "logclaw-airflow.fullname" -}}
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
{{- define "logclaw-airflow.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources in this chart.
*/}}
{{- define "logclaw-airflow.labels" -}}
helm.sh/chart: {{ include "logclaw-airflow.chart" . }}
{{ include "logclaw-airflow.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: logclaw
{{- end }}

{{/*
Selector labels — used for pod selectors and service selectors.
*/}}
{{- define "logclaw-airflow.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-airflow.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use.
If serviceAccount.name is set, use it. Otherwise derive from fullname.
*/}}
{{- define "logclaw-airflow.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
  {{- if not (empty .Values.serviceAccount.name) }}
    {{- .Values.serviceAccount.name }}
  {{- else }}
    {{- include "logclaw-airflow.fullname" . }}
  {{- end }}
{{- else }}
  {{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Tenant ID — required. Guards against deployment without a tenant context.
Usage: {{ include "logclaw-airflow.tenantId" . }}
*/}}
{{- define "logclaw-airflow.tenantId" -}}
{{- if and .Values.global .Values.global.tenantId }}
  {{- .Values.global.tenantId | trim }}
{{- else }}
  {{- fail "global.tenantId is required. Set it in your tenant values file (e.g. --set global.tenantId=acme)." }}
{{- end }}
{{- end }}
