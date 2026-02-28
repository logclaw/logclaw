{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-ml-engine.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "logclaw-ml-engine.fullname" -}}
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
Create chart label value: name-version.
*/}}
{{- define "logclaw-ml-engine.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource in this chart.
*/}}
{{- define "logclaw-ml-engine.labels" -}}
helm.sh/chart: {{ include "logclaw-ml-engine.chart" . }}
{{ include "logclaw-ml-engine.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
logclaw.io/tenant: {{ include "logclaw-ml-engine.tenantId" . }}
{{- end }}

{{/*
Selector labels — stable subset used by Services and label selectors.
*/}}
{{- define "logclaw-ml-engine.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-ml-engine.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name — honours explicit override, falls back to fullname.
*/}}
{{- define "logclaw-ml-engine.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "logclaw-ml-engine.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Tenant ID — required guard. Fails loudly if not supplied.
Looks in .Values.global.tenantId first, then .Values.mlEngine.feast.config.project.
*/}}
{{- define "logclaw-ml-engine.tenantId" -}}
{{- $tid := "" }}
{{- if .Values.global }}
{{- $tid = .Values.global.tenantId | default "" }}
{{- end }}
{{- if and (eq $tid "") .Values.mlEngine.feast.config.project }}
{{- $tid = .Values.mlEngine.feast.config.project }}
{{- end }}
{{- if eq $tid "" }}
{{- fail "global.tenantId is required but not set. Pass --set global.tenantId=<your-tenant-id>" }}
{{- end }}
{{- $tid }}
{{- end }}

{{/*
Redis host — returns the Bitnami bundled Redis master service hostname when
mlEngine.redis.bundled=true; otherwise returns global.externalRedis.host.
*/}}
{{- define "logclaw-ml-engine.redisHost" -}}
{{- if .Values.mlEngine.redis.bundled }}
{{- printf "%s-redis-master.%s.svc.%s" (include "logclaw-ml-engine.fullname" .) .Release.Namespace (.Values.global.clusterDomain | default "cluster.local") }}
{{- else }}
{{- required "global.externalRedis.host is required when mlEngine.redis.bundled=false" .Values.global.externalRedis.host }}
{{- end }}
{{- end }}

{{/*
InferenceService name — <fullname>-anomaly-predictor, capped at 63 chars.
*/}}
{{- define "logclaw-ml-engine.inferenceServiceName" -}}
{{- printf "%s-anomaly-predictor" (include "logclaw-ml-engine.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Feast feature server service name (used to build the FQDN for KServe env var).
*/}}
{{- define "logclaw-ml-engine.feastServiceName" -}}
{{- printf "%s-feast-server" (include "logclaw-ml-engine.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Feast feature server full FQDN for cluster-internal consumption.
*/}}
{{- define "logclaw-ml-engine.feastFQDN" -}}
{{- printf "%s.%s.svc.%s" (include "logclaw-ml-engine.feastServiceName" .) .Release.Namespace (.Values.global.clusterDomain | default "cluster.local") }}
{{- end }}
