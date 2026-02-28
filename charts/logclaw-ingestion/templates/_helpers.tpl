{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-ingestion.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "logclaw-ingestion.fullname" -}}
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
{{- define "logclaw-ingestion.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "logclaw-ingestion.labels" -}}
helm.sh/chart: {{ include "logclaw-ingestion.chart" . }}
{{ include "logclaw-ingestion.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: logclaw
{{- end }}

{{/*
Selector labels — used by Deployments/DaemonSets and their Services to match pods.
*/}}
{{- define "logclaw-ingestion.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-ingestion.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: ingestion
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "logclaw-ingestion.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "logclaw-ingestion.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Required guard: tenant ID must be set via global.tenantId.
Renders the tenant ID value or fails with a descriptive error.
Usage: {{ include "logclaw.tenantId" . }}
*/}}
{{- define "logclaw.tenantId" -}}
{{- if not ((.Values.global).tenantId) }}
{{- fail "global.tenantId is required. Set it in your values file or with --set global.tenantId=<your-tenant-id>" }}
{{- end }}
{{- .Values.global.tenantId }}
{{- end }}

{{/*
Resolve the Kafka bootstrap servers from global config.
Fails fast if not provided.
*/}}
{{- define "logclaw.kafkaBrokers" -}}
{{- if not ((.Values.global).kafkaBrokers) }}
{{- fail "global.kafkaBrokers is required. Set it in your values file or with --set global.kafkaBrokers=<broker:port>" }}
{{- end }}
{{- .Values.global.kafkaBrokers }}
{{- end }}

{{/*
Resolve the Kafka raw-logs topic from global config.
Fails fast if not provided.
*/}}
{{- define "logclaw.kafkaRawLogsTopic" -}}
{{- if not (((.Values.global).kafkaTopics).rawLogs) }}
{{- fail "global.kafkaTopics.rawLogs is required. Set it in your values file or with --set global.kafkaTopics.rawLogs=<topic>" }}
{{- end }}
{{- .Values.global.kafkaTopics.rawLogs }}
{{- end }}

{{/*
Topology key used for spread constraints.
Defaults to "topology.kubernetes.io/zone" if not set globally.
*/}}
{{- define "logclaw.topologyKey" -}}
{{- default "topology.kubernetes.io/zone" ((.Values.global).topologyKey) }}
{{- end }}
