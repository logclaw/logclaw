{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-tenant.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "logclaw-tenant.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "logclaw-%s" (include "logclaw.tenantId" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Chart name and version label.
*/}}
{{- define "logclaw-tenant.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Validated tenant ID helper — fails fast if not set.
*/}}
{{- define "logclaw.tenantId" -}}
{{- required "global.tenantId is required and cannot be empty" .Values.global.tenantId }}
{{- end }}

{{/*
Common labels attached to all resources.
*/}}
{{- define "logclaw-tenant.labels" -}}
helm.sh/chart: {{ include "logclaw-tenant.chart" . }}
{{ include "logclaw-tenant.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
logclaw.io/tenant: {{ include "logclaw.tenantId" . | quote }}
logclaw.io/tier: {{ .Values.global.tier | quote }}
{{- end }}

{{/*
Selector labels — must be stable across upgrades (do not add mutable fields here).
*/}}
{{- define "logclaw-tenant.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-tenant.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Resource quota preset — returns CPU and memory values based on global.tier.
*/}}
{{- define "logclaw-tenant.quotaPreset" -}}
{{- $tier := .Values.global.tier }}
{{- if eq $tier "standard" }}
requests.cpu: "20"
requests.memory: "80Gi"
limits.cpu: "40"
limits.memory: "160Gi"
requests.storage: "5Ti"
persistentvolumeclaims: "50"
{{- else if eq $tier "ha" }}
requests.cpu: "60"
requests.memory: "240Gi"
limits.cpu: "120"
limits.memory: "480Gi"
requests.storage: "20Ti"
persistentvolumeclaims: "100"
{{- else if eq $tier "ultra-ha" }}
requests.cpu: "200"
requests.memory: "800Gi"
limits.cpu: "400"
limits.memory: "1600Gi"
requests.storage: "100Ti"
persistentvolumeclaims: "500"
{{- else }}
{{- fail (printf "global.tier must be one of: standard, ha, ultra-ha. Got: %s" $tier) }}
{{- end }}
{{- end }}
