{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-zammad.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "logclaw-zammad.fullname" -}}
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
Create chart label.
*/}}
{{- define "logclaw-zammad.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "logclaw-zammad.labels" -}}
helm.sh/chart: {{ include "logclaw-zammad.chart" . }}
{{ include "logclaw-zammad.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: logclaw
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "logclaw-zammad.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-zammad.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Required: tenantId from global values.
*/}}
{{- define "logclaw-zammad.tenantId" -}}
{{- if and .Values.global .Values.global.tenantId }}
{{- .Values.global.tenantId | trim }}
{{- else }}
{{- fail "global.tenantId is required for logclaw-zammad." }}
{{- end }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "logclaw-zammad.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "logclaw-zammad.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
