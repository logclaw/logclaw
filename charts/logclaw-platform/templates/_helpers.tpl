{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "logclaw-platform.fullname" -}}
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
{{- define "logclaw-platform.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources managed by this chart.
*/}}
{{- define "logclaw-platform.labels" -}}
helm.sh/chart: {{ include "logclaw-platform.chart" . }}
{{ include "logclaw-platform.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: logclaw
{{- end }}

{{/*
Selector labels used in matchLabels and pod template labels.
*/}}
{{- define "logclaw-platform.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use.
If serviceAccount.name is set, use it; otherwise derive from fullname.
*/}}
{{- define "logclaw-platform.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "logclaw-platform.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Return the tenant ID from global values.
Fails with a clear error message if global.tenantId is not set.
Usage: {{ include "logclaw.tenantId" . }}
*/}}
{{- define "logclaw.tenantId" -}}
{{- required "global.tenantId is required and must be set in the umbrella chart values" .Values.global.tenantId }}
{{- end }}
