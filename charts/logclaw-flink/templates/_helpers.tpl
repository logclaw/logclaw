{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-flink.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec). If the release name contains chart name it will be
used as a full name.
*/}}
{{- define "logclaw-flink.fullname" -}}
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
{{- define "logclaw-flink.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "logclaw-flink.labels" -}}
helm.sh/chart: {{ include "logclaw-flink.chart" . }}
{{ include "logclaw-flink.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: logclaw
logclaw.io/component: flink
{{- end }}

{{/*
Selector labels
*/}}
{{- define "logclaw-flink.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-flink.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "logclaw-flink.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "logclaw-flink.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Validate that global.tenantId is set (required guard).
Usage: {{ include "logclaw-flink.tenantId" . }}
*/}}
{{- define "logclaw-flink.tenantId" -}}
{{- if not ((.Values.global).tenantId) }}
{{- fail "global.tenantId is required and must be set in values. Example: --set global.tenantId=acme-corp" }}
{{- end }}
{{- .Values.global.tenantId }}
{{- end }}

{{/*
Return the checkpoint base directory using the configured object storage.
Usage: {{ include "logclaw-flink.checkpointDir" . }}
Produces e.g.: s3://my-bucket/flink/checkpoints
*/}}
{{- define "logclaw-flink.checkpointDir" -}}
{{- $provider := (.Values.global).objectStorage | default dict | dig "provider" "s3" }}
{{- $bucket  := (.Values.global).objectStorage | default dict | dig "bucket" "" }}
{{- if not $bucket }}
{{- fail "global.objectStorage.bucket is required for checkpoint storage" }}
{{- end }}
{{- printf "%s://%s/flink/checkpoints" $provider $bucket }}
{{- end }}

{{/*
Return the savepoint base directory using the configured object storage.
Usage: {{ include "logclaw-flink.savepointDir" . }}
*/}}
{{- define "logclaw-flink.savepointDir" -}}
{{- $provider := (.Values.global).objectStorage | default dict | dig "provider" "s3" }}
{{- $bucket  := (.Values.global).objectStorage | default dict | dig "bucket" "" }}
{{- if not $bucket }}
{{- fail "global.objectStorage.bucket is required for savepoint storage" }}
{{- end }}
{{- printf "%s://%s/flink/savepoints" $provider $bucket }}
{{- end }}

{{/*
Return the Flink version string prefixed with 'v'.
Usage: {{ include "logclaw-flink.flinkVersion" . }}
Produces e.g.: v1.19
*/}}
{{- define "logclaw-flink.flinkVersion" -}}
{{- printf "v%s" .Values.flink.version }}
{{- end }}

{{/*
Return the cluster domain, defaulting to cluster.local.
*/}}
{{- define "logclaw-flink.clusterDomain" -}}
{{- (.Values.global).clusterDomain | default "cluster.local" }}
{{- end }}

{{/*
Render the merged flinkConfiguration map (base config + checkpoint/savepoint dirs).
*/}}
{{- define "logclaw-flink.flinkConfiguration" -}}
{{- $cfg := deepCopy (.Values.flink.config | default dict) }}
{{- $_ := set $cfg "state.checkpoints.dir" (include "logclaw-flink.checkpointDir" .) }}
{{- $_ := set $cfg "state.savepoints.dir"   (include "logclaw-flink.savepointDir" .) }}
{{- toYaml $cfg }}
{{- end }}
