{{/*
Expand the name of the chart.
*/}}
{{- define "logclaw-ticketing-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "logclaw-ticketing-agent.fullname" -}}
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
{{- define "logclaw-ticketing-agent.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "logclaw-ticketing-agent.labels" -}}
helm.sh/chart: {{ include "logclaw-ticketing-agent.chart" . }}
{{ include "logclaw-ticketing-agent.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: logclaw
{{- end }}

{{/*
Selector labels
*/}}
{{- define "logclaw-ticketing-agent.selectorLabels" -}}
app.kubernetes.io/name: {{ include "logclaw-ticketing-agent.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: ticketing-agent
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "logclaw-ticketing-agent.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "logclaw-ticketing-agent.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Resolve tenantId — required; fail loudly if not provided.
Must be set via global.tenantId in parent chart or --set.
*/}}
{{- define "logclaw-ticketing-agent.tenantId" -}}
{{- if .Values.global -}}
  {{- if .Values.global.tenantId -}}
    {{- .Values.global.tenantId -}}
  {{- else -}}
    {{- fail "global.tenantId is required and must not be empty. Set it with --set global.tenantId=<your-tenant-id>" -}}
  {{- end -}}
{{- else -}}
  {{- fail "global.tenantId is required and must not be empty. Set it with --set global.tenantId=<your-tenant-id>" -}}
{{- end -}}
{{- end }}

{{/*
Resolve kafkaBrokers — required global value.
*/}}
{{- define "logclaw-ticketing-agent.kafkaBrokers" -}}
{{- if .Values.global -}}
  {{- if .Values.global.kafkaBrokers -}}
    {{- .Values.global.kafkaBrokers -}}
  {{- else -}}
    {{- fail "global.kafkaBrokers is required and must not be empty." -}}
  {{- end -}}
{{- else -}}
  {{- fail "global.kafkaBrokers is required and must not be empty." -}}
{{- end -}}
{{- end }}

{{/*
Resolve anomalies Kafka topic — required global value.
*/}}
{{- define "logclaw-ticketing-agent.kafkaTopicAnomalies" -}}
{{- if .Values.global -}}
  {{- if .Values.global.kafkaTopics -}}
    {{- if .Values.global.kafkaTopics.anomalies -}}
      {{- .Values.global.kafkaTopics.anomalies -}}
    {{- else -}}
      {{- fail "global.kafkaTopics.anomalies is required and must not be empty." -}}
    {{- end -}}
  {{- else -}}
    {{- fail "global.kafkaTopics is required and must not be empty." -}}
  {{- end -}}
{{- else -}}
  {{- fail "global.kafkaTopics.anomalies is required and must not be empty." -}}
{{- end -}}
{{- end }}

{{/*
Resolve opensearchEndpoint — required global value.
*/}}
{{- define "logclaw-ticketing-agent.opensearchEndpoint" -}}
{{- if .Values.global -}}
  {{- if .Values.global.opensearchEndpoint -}}
    {{- .Values.global.opensearchEndpoint -}}
  {{- else -}}
    {{- fail "global.opensearchEndpoint is required and must not be empty." -}}
  {{- end -}}
{{- else -}}
  {{- fail "global.opensearchEndpoint is required and must not be empty." -}}
{{- end -}}
{{- end }}

{{/*
Name of the ExternalSecret-managed secret.
*/}}
{{- define "logclaw-ticketing-agent.secretName" -}}
{{- printf "%s-secrets" (include "logclaw-ticketing-agent.fullname" .) }}
{{- end }}

{{/*
Name of the ConfigMap (YAML config).
*/}}
{{- define "logclaw-ticketing-agent.configMapName" -}}
{{- printf "%s-config" (include "logclaw-ticketing-agent.fullname" .) }}
{{- end }}

{{/*
Name of the App ConfigMap (Python code).
*/}}
{{- define "logclaw-ticketing-agent.configMapAppName" -}}
{{- printf "%s-app" (include "logclaw-ticketing-agent.fullname" .) }}
{{- end }}

{{/*
Resolve logclawTenantId — the tenant for LogClaw's own dogfooding logs.
Defaults to "logclaw" if not set via global.logclawTenantId.
*/}}
{{- define "logclaw-ticketing-agent.logclawTenantId" -}}
{{- if .Values.global -}}
  {{- .Values.global.logclawTenantId | default "logclaw" -}}
{{- else -}}
  {{- "logclaw" -}}
{{- end -}}
{{- end }}

{{/*
Topology spread key — defaults to topology.kubernetes.io/zone if not set.
*/}}
{{- define "logclaw-ticketing-agent.topologyKey" -}}
{{- if .Values.global -}}
  {{- default "topology.kubernetes.io/zone" .Values.global.topologyKey -}}
{{- else -}}
  {{- "topology.kubernetes.io/zone" -}}
{{- end -}}
{{- end }}

{{/*
Resolve the effective LLM provider. Global value takes precedence over local.
Valid values: claude | openai | ollama | vllm | disabled
*/}}
{{- define "logclaw-ticketing-agent.llmProvider" -}}
{{- $p := "" -}}
{{- if .Values.global -}}
  {{- if .Values.global.llm -}}
    {{- $p = .Values.global.llm.provider | default "" -}}
  {{- end -}}
{{- end -}}
{{- $p | default .Values.llm.provider | default "disabled" -}}
{{- end }}

{{/*
Resolve the LLM model name. Global value takes precedence.
*/}}
{{- define "logclaw-ticketing-agent.llmModel" -}}
{{- $m := "" -}}
{{- if .Values.global -}}
  {{- if .Values.global.llm -}}
    {{- $m = .Values.global.llm.model | default "" -}}
  {{- end -}}
{{- end -}}
{{- $m | default .Values.llm.model | default "llama3.2:8b" -}}
{{- end }}

{{/*
Resolve the LLM API endpoint based on provider.
  ollama  -> in-cluster Ollama service in the ml-engine release
  claude  -> https://api.anthropic.com
  openai  -> https://api.openai.com
  vllm    -> global.llm.endpoint (required; fail if empty)
  disabled -> ""
*/}}
{{- define "logclaw-ticketing-agent.llmEndpoint" -}}
{{- $provider := include "logclaw-ticketing-agent.llmProvider" . -}}
{{- if eq $provider "ollama" -}}
{{- $tenantId := include "logclaw-ticketing-agent.tenantId" . -}}
{{- $clusterDomain := ((.Values.global).clusterDomain) | default "cluster.local" -}}
http://logclaw-ml-engine-{{ $tenantId }}-ollama.{{ .Release.Namespace }}.svc.{{ $clusterDomain }}:11434
{{- else if eq $provider "claude" -}}
https://api.anthropic.com
{{- else if eq $provider "openai" -}}
https://api.openai.com
{{- else if eq $provider "vllm" -}}
{{- $ep := "" -}}
{{- if .Values.global -}}{{- if .Values.global.llm -}}{{- $ep = .Values.global.llm.endpoint | default "" -}}{{- end -}}{{- end -}}
{{- if not $ep -}}{{- $ep = .Values.llm.endpoint -}}{{- end -}}
{{- required "global.llm.endpoint is required when llm.provider=vllm" $ep -}}
{{- else -}}
{{- "" -}}
{{- end -}}
{{- end }}

{{/*
Resolve the ordered LLM provider+model chain as a comma-separated string.
Format: "provider:model,provider:model,..." e.g. "openai:gpt-4o-mini,openai:gpt-4o,claude:claude-3-5-haiku-latest"
Falls back to single llmProvider:llmModel for backward compat.
*/}}
{{- define "logclaw-ticketing-agent.llmProviders" -}}
{{- $providers := list -}}
{{- $llm := .Values.llm -}}
{{- if .Values.global -}}{{- if .Values.global.llm -}}{{- if .Values.global.llm.providers -}}
  {{- $llm = .Values.global.llm -}}
{{- end -}}{{- end -}}{{- end -}}
{{- if $llm.providers -}}
  {{- range $llm.providers -}}
    {{- $entry := printf "%s:%s" .name (.model | default "") -}}
    {{- $providers = append $providers $entry -}}
  {{- end -}}
  {{- join "," $providers -}}
{{- else -}}
  {{- $p := include "logclaw-ticketing-agent.llmProvider" $ -}}
  {{- $m := include "logclaw-ticketing-agent.llmModel" $ -}}
  {{- if and (ne $p "disabled") $p -}}
    {{- printf "%s:%s" $p $m -}}
  {{- end -}}
{{- end -}}
{{- end }}

{{/*
Check if any LLM provider in the chain is a cloud provider (needs external HTTPS).
*/}}
{{- define "logclaw-ticketing-agent.llmHasCloudProvider" -}}
{{- $found := false -}}
{{- $llm := .Values.llm -}}
{{- if .Values.global -}}{{- if .Values.global.llm -}}{{- if .Values.global.llm.providers -}}
  {{- $llm = .Values.global.llm -}}
{{- end -}}{{- end -}}{{- end -}}
{{- if $llm.providers -}}
  {{- range $llm.providers -}}
    {{- if or (eq .name "claude") (eq .name "openai") -}}
      {{- $found = true -}}
    {{- end -}}
  {{- end -}}
{{- else -}}
  {{- $p := include "logclaw-ticketing-agent.llmProvider" $ -}}
  {{- if or (eq $p "claude") (eq $p "openai") -}}
    {{- $found = true -}}
  {{- end -}}
{{- end -}}
{{- if $found -}}true{{- else -}}false{{- end -}}
{{- end }}

{{/*
Returns "true" if any platform requires outbound external HTTPS (port 443).
Covers: PagerDuty, Jira, ServiceNow, OpsGenie, Slack, and cloud LLMs (Claude/OpenAI).
*/}}
{{- define "logclaw-ticketing-agent.needsExternalHttps" -}}
{{- $llmExternal := eq (include "logclaw-ticketing-agent.llmHasCloudProvider" .) "true" -}}
{{- $extPlatform := or .Values.config.pagerduty.enabled (or .Values.config.jira.enabled (or .Values.config.servicenow.enabled (or .Values.config.opsgenie.enabled .Values.config.slack.enabled))) -}}
{{- if or $llmExternal $extPlatform -}}true{{- else -}}false{{- end -}}
{{- end }}
