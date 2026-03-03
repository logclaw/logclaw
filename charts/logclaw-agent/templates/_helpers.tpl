{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "logclaw-agent.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Tenant ID — required.
*/}}
{{- define "logclaw-agent.tenantId" -}}
{{- required "global.tenantId is required" .Values.global.tenantId }}
{{- end }}

{{/*
Namespace where the LogClaw stack lives.
*/}}
{{- define "logclaw-agent.stackNamespace" -}}
{{- .Values.global.namespace | default .Release.Namespace }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "logclaw-agent.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/name: {{ include "logclaw-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
logclaw.io/tenant: {{ include "logclaw-agent.tenantId" . }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "logclaw-agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
