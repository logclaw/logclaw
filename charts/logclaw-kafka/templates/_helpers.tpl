{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-kafka.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "logclaw-kafka.fullname" -}}
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
{{- define "logclaw-kafka.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "logclaw-kafka.labels" -}}
helm.sh/chart: {{ include "logclaw-kafka.chart" . }}
{{ include "logclaw-kafka.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: logclaw
{{- end }}

{{/*
Selector labels
*/}}
{{- define "logclaw-kafka.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-kafka.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Tenant ID — required guard. Fails loudly if not provided.
*/}}
{{- define "logclaw.tenantId" -}}
{{- required "global.tenantId is required. Pass --set global.tenantId=<your-tenant-id>" .Values.global.tenantId }}
{{- end }}

{{/*
Bootstrap server address for the Kafka TLS listener.
Returns the internal cluster DNS name for port 9093.
*/}}
{{- define "logclaw-kafka.bootstrapServer" -}}
{{- $clusterDomain := default "cluster.local" .Values.global.clusterDomain -}}
{{- printf "%s-kafka-bootstrap.%s.svc.%s:9093" .Release.Name .Release.Namespace $clusterDomain }}
{{- end }}
