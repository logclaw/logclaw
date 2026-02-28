{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-opensearch.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this.
If release name contains the chart name, avoid duplication.
*/}}
{{- define "logclaw-opensearch.fullname" -}}
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
Create chart label value (chart name + version).
*/}}
{{- define "logclaw-opensearch.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "logclaw-opensearch.labels" -}}
helm.sh/chart: {{ include "logclaw-opensearch.chart" . }}
{{ include "logclaw-opensearch.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
logclaw.io/component: hot-tier-storage
{{- with ((.Values.global).tenantId) }}
logclaw.io/tenant: {{ . }}
{{- end }}
{{- end }}

{{/*
Selector labels used for pod selection and matching.
*/}}
{{- define "logclaw-opensearch.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-opensearch.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Require and return the tenantId from global values.
Fails loudly if not set, preventing misconfigured deployments.
*/}}
{{- define "logclaw-opensearch.tenantId" -}}
{{- $tenantId := ((.Values.global).tenantId) }}
{{- if not $tenantId }}
{{- fail "global.tenantId is required and must be set. Pass --set global.tenantId=<tenant> or define it in your values file." }}
{{- end }}
{{- $tenantId }}
{{- end }}

{{/*
Return the admin credentials secret name.
Falls back to the value in adminCredentialsSecret.name.
*/}}
{{- define "logclaw-opensearch.adminSecretName" -}}
{{- .Values.adminCredentialsSecret.name | default "opensearch-admin-credentials" }}
{{- end }}

{{/*
Return the ExternalSecret store name.
Prefers adminCredentialsSecret.secretStoreName, then global.secretStore.name.
Fails if neither is set when createExternalSecret is true.
*/}}
{{- define "logclaw-opensearch.secretStoreName" -}}
{{- $store := .Values.adminCredentialsSecret.secretStoreName }}
{{- if not $store }}
{{- $store = ((.Values.global).secretStore).name }}
{{- end }}
{{- if not $store }}
{{- fail "A secret store name is required. Set adminCredentialsSecret.secretStoreName or global.secretStore.name." }}
{{- end }}
{{- $store }}
{{- end }}

{{/*
Return the cluster domain, defaulting to cluster.local.
*/}}
{{- define "logclaw-opensearch.clusterDomain" -}}
{{- ((.Values.global).clusterDomain) | default "cluster.local" }}
{{- end }}

{{/*
Return the primary storage class (high-throughput preferred, then default).
*/}}
{{- define "logclaw-opensearch.storageClass" -}}
{{- $sc := ((.Values.global).storageClassHighThroughput) }}
{{- if not $sc }}
{{- $sc = ((.Values.global).storageClass) }}
{{- end }}
{{- $sc }}
{{- end }}

{{/*
Return the topology spread key, defaulting to topology.kubernetes.io/zone.
*/}}
{{- define "logclaw-opensearch.topologyKey" -}}
{{- ((.Values.global).topologyKey) | default "topology.kubernetes.io/zone" }}
{{- end }}
