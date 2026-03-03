SHELL        := /bin/bash
.DEFAULT_GOAL := help

# ── Load environment variables from .env (if present) ─────────────────────────
# cp .env.dev .env   ← to get started
-include .env
export

# ── Ensure Homebrew tools are on PATH (macOS) ────────────────────────────────
export PATH := /opt/homebrew/bin:$(PATH)

# ── Core variables ────────────────────────────────────────────────────────────
CHARTS_DIR    := charts
TENANT_ID     ?= dev-local
NAMESPACE     := logclaw-$(TENANT_ID)
STORAGE_CLASS ?= standard
HELM          := helm
CT            := ct
KIND          := kind
KIND_CLUSTER  := logclaw-dev

# ── Port defaults (override in .env) ─────────────────────────────────────────
PORT_DASHBOARD ?= 3333
PORT_OPENSEARCH ?= 9200
PORT_INGESTION ?= 8080
PORT_TICKETING ?= 8081
PORT_BRIDGE    ?= 8083
PORT_AGENT     ?= 8084
PORT_AIRFLOW   ?= 8082

# ── Credential defaults (override in .env) ───────────────────────────────────
OPENSEARCH_ADMIN_USER      ?= admin
OPENSEARCH_ADMIN_PASSWORD  ?= admin
REDIS_PASSWORD             ?= dev-redis-password
AIRFLOW_FERNET_KEY         ?= ZGV2LWZlcm5ldC1rZXktMTIzNDU2Nzg5MGFiY2RlZj0=
AIRFLOW_WEBSERVER_SECRET   ?= dev-webserver-secret
AIRFLOW_POSTGRES_PASSWORD  ?= postgres
KAFKA_SASL_PASSWORD        ?= dev-kafka-password

# ── Docker image variables ─────────────────────────────────────────────────
REGISTRY       ?= ghcr.io/logclaw
DASHBOARD_IMG       := $(REGISTRY)/dashboard
BRIDGE_IMG          := $(REGISTRY)/bridge
TICKETING_AGENT_IMG := $(REGISTRY)/ticketing-agent
AGENT_IMG           := $(REGISTRY)/agent
DASHBOARD_VER       := 2.0.0
BRIDGE_VER          := 1.0.0
TICKETING_AGENT_VER := 1.0.0
AGENT_VER           := 0.1.0
GIT_SHA        := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
PLATFORM       ?= linux/amd64,linux/arm64

.PHONY: help up down restart status ports kill-ports nuke \
        deps lint lint-umbrella validate-schema template template-diff \
        kind-create kind-delete install-operators create-dev-secrets install uninstall \
        dashboard test ct-install package push clean \
        build-dashboard build-bridge build-ticketing-agent build-agent build-all \
        push-dashboard push-bridge push-ticketing-agent push-agent push-all \
        scan-dashboard scan-bridge scan-ticketing-agent scan-agent scan-all \
        kind-load-dashboard kind-load-bridge kind-load-ticketing-agent kind-load-agent kind-load-all

# ═══════════════════════════════════════════════════════════════════════════════
# Quick-start targets
# ═══════════════════════════════════════════════════════════════════════════════

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

up: ## 🚀 Full setup: cluster → operators → secrets → deploy → ports → browser
	@echo "╔═══════════════════════════════════════════════════════════╗"
	@echo "║  LogClaw — starting up (TENANT_ID=$(TENANT_ID))  ║"
	@echo "╚═══════════════════════════════════════════════════════════╝"
	@# 1. Kind cluster (skip if exists)
	@$(KIND) get clusters 2>/dev/null | grep -q "^$(KIND_CLUSTER)$$" \
		&& echo "✓ Kind cluster $(KIND_CLUSTER) already exists" \
		|| $(MAKE) kind-create
	@# 2. Operators (skip if Strimzi CRD exists)
	@kubectl get crd kafkas.kafka.strimzi.io >/dev/null 2>&1 \
		&& echo "✓ Operators already installed" \
		|| $(MAKE) install-operators
	@# 3. Secrets
	@$(MAKE) create-dev-secrets
	@# 4. Deploy all services via helmfile
	@$(MAKE) install
	@# 5. Wait for pods to be ready
	@echo "⏳ Waiting for pods to become ready..."
	@kubectl -n $(NAMESPACE) wait --for=condition=ready pod --all --timeout=300s 2>/dev/null || true
	@# 6. Port-forward and open dashboard
	@$(MAKE) ports
	@echo ""
	@echo "╔═══════════════════════════════════════════════════════════╗"
	@echo "║  ✅ LogClaw is running!                                   ║"
	@echo "║                                                           ║"
	@echo "║  Dashboard:  http://localhost:$(PORT_DASHBOARD)                        ║"
	@echo "║  API Docs:   http://localhost:$(PORT_DASHBOARD)/#ingestion             ║"
	@echo "║  Ticketing:  http://localhost:$(PORT_TICKETING)                        ║"
	@echo "║  OpenSearch: http://localhost:$(PORT_OPENSEARCH)                        ║"
	@echo "║                                                           ║"
	@echo "║  Run 'make status' to check health                        ║"
	@echo "║  Run 'make down' to stop                                  ║"
	@echo "╚═══════════════════════════════════════════════════════════╝"

down: ## 🛑 Tear down services (keeps Kind cluster)
	@echo "Stopping LogClaw..."
	@$(MAKE) kill-ports
	@TENANT_ID=$(TENANT_ID) helmfile --file helmfile.yaml destroy 2>/dev/null || true
	@kubectl delete namespace $(NAMESPACE) --ignore-not-found=true
	@echo "✅ LogClaw stopped. Run 'make up' to restart."

restart: ## 🔄 Clean restart (down → up)
	@$(MAKE) down
	@sleep 3
	@$(MAKE) up

nuke: ## 💥 Delete everything including Kind cluster
	@$(MAKE) kill-ports
	@TENANT_ID=$(TENANT_ID) helmfile --file helmfile.yaml destroy 2>/dev/null || true
	@kubectl delete namespace $(NAMESPACE) --ignore-not-found=true 2>/dev/null || true
	@$(KIND) delete cluster --name $(KIND_CLUSTER) 2>/dev/null || true
	@echo "✅ Everything deleted. Run 'make up' to start fresh."

status: ## 📊 Show pod status, services, and endpoints
	@echo "╔═══════════════════════════════════════════════════════════╗"
	@echo "║  LogClaw Status ($(NAMESPACE))                ║"
	@echo "╚═══════════════════════════════════════════════════════════╝"
	@echo ""
	@echo "── Pods ──────────────────────────────────────────────────────"
	@kubectl -n $(NAMESPACE) get pods -o wide 2>/dev/null || echo "  (namespace not found)"
	@echo ""
	@echo "── Services ──────────────────────────────────────────────────"
	@kubectl -n $(NAMESPACE) get svc 2>/dev/null || echo "  (namespace not found)"
	@echo ""
	@echo "── Port Forwards ─────────────────────────────────────────────"
	@ps aux | grep '[p]ort-forward.*logclaw' | awk '{for(i=11;i<=NF;i++) printf "%s ",$$i; print ""}' || echo "  (none active)"
	@echo ""
	@echo "── Endpoints ─────────────────────────────────────────────────"
	@echo "  Dashboard:  http://localhost:$(PORT_DASHBOARD)"
	@echo "  Ticketing:  http://localhost:$(PORT_TICKETING)"
	@echo "  Bridge:     http://localhost:$(PORT_BRIDGE)"
	@echo "  Agent:      http://localhost:$(PORT_AGENT)"
	@echo "  Ingestion:  http://localhost:$(PORT_INGESTION)"
	@echo "  OpenSearch: http://localhost:$(PORT_OPENSEARCH)"
	@echo "  Airflow:    http://localhost:$(PORT_AIRFLOW)"
	@echo ""
	@echo "── Environment ───────────────────────────────────────────────"
	@echo "  TENANT_ID=$(TENANT_ID)"
	@echo "  KAFKA_EXTERNAL=$(KAFKA_EXTERNAL)"
	@echo "  OPENSEARCH_EXTERNAL=$(OPENSEARCH_EXTERNAL)"
	@echo "  REDIS_EXTERNAL=$(REDIS_EXTERNAL)"
	@echo "  POSTGRES_EXTERNAL=$(POSTGRES_EXTERNAL)"
	@echo "  LLM_PROVIDER=$(LLM_PROVIDER)"

ports: kill-ports ## 🔌 Start all port-forwards
	@echo "Starting port-forwards..."
	@kubectl -n $(NAMESPACE) port-forward svc/logclaw-dashboard-$(TENANT_ID) $(PORT_DASHBOARD):3000 >/dev/null 2>&1 &
	@kubectl -n $(NAMESPACE) port-forward svc/logclaw-ticketing-agent-$(TENANT_ID) $(PORT_TICKETING):8080 >/dev/null 2>&1 &
	@kubectl -n $(NAMESPACE) port-forward svc/logclaw-bridge-$(TENANT_ID) $(PORT_BRIDGE):8080 >/dev/null 2>&1 &
	@kubectl -n $(NAMESPACE) port-forward svc/logclaw-ingestion-$(TENANT_ID) $(PORT_INGESTION):8080 >/dev/null 2>&1 &
	@kubectl -n $(NAMESPACE) port-forward svc/logclaw-opensearch-$(TENANT_ID) $(PORT_OPENSEARCH):9200 >/dev/null 2>&1 &
	@kubectl -n $(NAMESPACE) port-forward svc/logclaw-agent-$(TENANT_ID)-logclaw-agent $(PORT_AGENT):8080 >/dev/null 2>&1 &
	@kubectl -n $(NAMESPACE) port-forward svc/logclaw-airflow-$(TENANT_ID)-webserver $(PORT_AIRFLOW):8080 >/dev/null 2>&1 &
	@sleep 2
	@echo "✓ Port-forwards active"

kill-ports: ## Kill all LogClaw port-forwards
	@pkill -f "port-forward.*logclaw" 2>/dev/null || true
	@sleep 1

dashboard: ports ## Open LogClaw dashboard in browser
	@open http://localhost:$(PORT_DASHBOARD) 2>/dev/null || echo "Open http://localhost:$(PORT_DASHBOARD) in your browser"

# ═══════════════════════════════════════════════════════════════════════════════
# Cluster & deployment targets
# ═══════════════════════════════════════════════════════════════════════════════

kind-create: ## Create local Kind cluster
	$(KIND) create cluster --name $(KIND_CLUSTER) --wait 60s
	kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.1/cert-manager.crds.yaml --server-side || true
	kubectl label node $(KIND_CLUSTER)-control-plane topology.kubernetes.io/zone=zone-a --overwrite
	@echo "✓ Kind cluster $(KIND_CLUSTER) ready"

kind-delete: ## Delete local Kind cluster
	$(KIND) delete cluster --name $(KIND_CLUSTER)

install-operators: ## Install cluster-level operators (Strimzi, cert-manager, etc.)
	TENANT_ID=$(TENANT_ID) helmfile --file helmfile.d/00-operators.yaml apply

create-dev-secrets: ## Create K8s secrets (reads credentials from .env)
	@kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -
	@kubectl create secret generic opensearch-admin-credentials \
		--namespace $(NAMESPACE) \
		--from-literal=username=$(OPENSEARCH_ADMIN_USER) \
		--from-literal=password=$(OPENSEARCH_ADMIN_PASSWORD) \
		--dry-run=client -o yaml | kubectl apply -f -
	@kubectl create secret generic logclaw-ml-engine-redis-credentials \
		--namespace $(NAMESPACE) \
		--from-literal=redis-password=$(REDIS_PASSWORD) \
		--dry-run=client -o yaml | kubectl apply -f -
	@kubectl create secret generic logclaw-airflow-credentials \
		--namespace $(NAMESPACE) \
		--from-literal=fernet-key=$(AIRFLOW_FERNET_KEY) \
		--from-literal=webserver-secret-key=$(AIRFLOW_WEBSERVER_SECRET) \
		--from-literal=postgresql-password=$(AIRFLOW_POSTGRES_PASSWORD) \
		--dry-run=client -o yaml | kubectl apply -f -
	@kubectl create secret generic airflow-git-ssh \
		--namespace $(NAMESPACE) --from-literal=gitSshKey="" \
		--dry-run=client -o yaml | kubectl apply -f -
	@kubectl create secret generic logclaw-ticketing-agent-$(TENANT_ID)-credentials \
		--namespace $(NAMESPACE) \
		--from-literal=KAFKA_SASL_PASSWORD=$(KAFKA_SASL_PASSWORD) \
		--from-literal=OPENSEARCH_PASSWORD=$(OPENSEARCH_ADMIN_PASSWORD) \
		--dry-run=client -o yaml | kubectl apply -f -
	@echo "✓ Secrets created in $(NAMESPACE)"

install: deps create-dev-secrets ## Install full tenant stack via helmfile
	TENANT_ID=$(TENANT_ID) STORAGE_CLASS=$(STORAGE_CLASS) helmfile --file helmfile.yaml apply

uninstall: ## Uninstall tenant (WARNING: destructive)
	$(HELM) uninstall logclaw-$(TENANT_ID) --namespace $(NAMESPACE) || true
	kubectl delete namespace $(NAMESPACE) --ignore-not-found=true

# ═══════════════════════════════════════════════════════════════════════════════
# Development & CI targets
# ═══════════════════════════════════════════════════════════════════════════════

deps: ## Update helm dependencies for all charts
	@for chart in $(CHARTS_DIR)/*/; do \
		echo "==> Updating deps: $$chart"; \
		$(HELM) dependency update "$$chart" 2>/dev/null || true; \
	done

lint: deps ## Lint all charts
	@for chart in $(CHARTS_DIR)/*/; do \
		echo "==> Linting: $$chart"; \
		$(HELM) lint "$$chart" \
			--values "$$chart/ci/default-values.yaml" \
			--strict \
			--set global.tenantId=lint-test \
			--set global.objectStorage.bucket=lint-bucket || exit 1; \
	done
	@echo "All charts passed lint"

lint-umbrella: ## Lint umbrella chart with HA values
	$(HELM) lint $(CHARTS_DIR)/logclaw-tenant \
		--values $(CHARTS_DIR)/logclaw-tenant/ci/ha-values.yaml \
		--strict \
		--set global.tenantId=lint-ha-test \
		--set global.objectStorage.bucket=lint-bucket

validate-schema: ## Validate values against schema for all charts
	@for chart in $(CHARTS_DIR)/*/; do \
		if [ -f "$$chart/values.schema.json" ]; then \
			echo "==> Schema: $$chart"; \
			$(HELM) lint "$$chart" \
				--values "$$chart/ci/default-values.yaml" \
				--strict \
				--set global.tenantId=schema-test \
				--set global.objectStorage.bucket=schema-bucket 2>&1 \
				| grep -E 'ERROR|WARNING' || true; \
		fi; \
	done

template: ## Render umbrella chart templates (dry-run)
	$(HELM) template logclaw-$(TENANT_ID) $(CHARTS_DIR)/logclaw-tenant \
		--namespace $(NAMESPACE) \
		--values $(CHARTS_DIR)/logclaw-tenant/ci/default-values.yaml \
		--set global.tenantId=$(TENANT_ID) \
		--set global.objectStorage.bucket=logclaw-$(TENANT_ID)-data \
		--debug

template-diff: ## Diff current install vs new templates
	$(HELM) diff upgrade logclaw-$(TENANT_ID) $(CHARTS_DIR)/logclaw-tenant \
		--namespace $(NAMESPACE) \
		--values $(CHARTS_DIR)/logclaw-tenant/ci/default-values.yaml \
		--set global.tenantId=$(TENANT_ID) \
		--set global.objectStorage.bucket=logclaw-$(TENANT_ID)-data

test: ## Run helm tests against installed release
	$(HELM) test logclaw-$(TENANT_ID) \
		--namespace $(NAMESPACE) \
		--timeout 5m \
		--logs

ct-install: deps ## Run ct install in ephemeral namespace
	$(CT) install \
		--config tests/ct.yaml \
		--all \
		--chart-dirs $(CHARTS_DIR) \
		--helm-extra-set-args "--set global.tenantId=ct-test --set global.objectStorage.bucket=ct-bucket"

package: deps ## Package all charts as .tgz
	mkdir -p dist
	@for chart in $(CHARTS_DIR)/*/; do \
		$(HELM) package "$$chart" --destination dist/; \
	done
	ls -la dist/

push: ## Push charts to OCI registry (requires HELM_REGISTRY)
	@test -n "$(HELM_REGISTRY)" || (echo "Set HELM_REGISTRY=oci://..." && exit 1)
	@for pkg in dist/*.tgz; do \
		$(HELM) push "$$pkg" oci://$(HELM_REGISTRY); \
	done

clean: ## Remove build artifacts
	rm -rf dist/
	find $(CHARTS_DIR) -name "Chart.lock" -delete 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════════
# Docker image targets
# ═══════════════════════════════════════════════════════════════════════════════

build-dashboard: ## Build dashboard Docker image (multi-arch)
	docker buildx build apps/dashboard \
		--platform $(PLATFORM) \
		-t $(DASHBOARD_IMG):$(DASHBOARD_VER) \
		-t $(DASHBOARD_IMG):sha-$(GIT_SHA) \
		-t $(DASHBOARD_IMG):latest \
		--load
	@echo "✓ Built $(DASHBOARD_IMG):$(DASHBOARD_VER)"

build-bridge: ## Build bridge Docker image (multi-arch)
	docker buildx build apps/bridge \
		--platform $(PLATFORM) \
		-t $(BRIDGE_IMG):$(BRIDGE_VER) \
		-t $(BRIDGE_IMG):sha-$(GIT_SHA) \
		-t $(BRIDGE_IMG):latest \
		--load
	@echo "✓ Built $(BRIDGE_IMG):$(BRIDGE_VER)"

build-ticketing-agent: ## Build ticketing-agent Docker image (multi-arch)
	docker buildx build apps/ticketing-agent \
		--platform $(PLATFORM) \
		-t $(TICKETING_AGENT_IMG):$(TICKETING_AGENT_VER) \
		-t $(TICKETING_AGENT_IMG):sha-$(GIT_SHA) \
		-t $(TICKETING_AGENT_IMG):latest \
		--load
	@echo "✓ Built $(TICKETING_AGENT_IMG):$(TICKETING_AGENT_VER)"

build-agent: ## Build agent Docker image (multi-arch)
	docker buildx build apps/agent \
		--platform $(PLATFORM) \
		-t $(AGENT_IMG):$(AGENT_VER) \
		-t $(AGENT_IMG):sha-$(GIT_SHA) \
		-t $(AGENT_IMG):latest \
		--load
	@echo "✓ Built $(AGENT_IMG):$(AGENT_VER)"

build-all: build-dashboard build-bridge build-ticketing-agent build-agent ## Build all Docker images

push-dashboard: ## Build + push dashboard to GHCR
	docker buildx build apps/dashboard \
		--platform $(PLATFORM) \
		-t $(DASHBOARD_IMG):$(DASHBOARD_VER) \
		-t $(DASHBOARD_IMG):sha-$(GIT_SHA) \
		-t $(DASHBOARD_IMG):latest \
		--push
	@echo "✓ Pushed $(DASHBOARD_IMG):$(DASHBOARD_VER)"

push-bridge: ## Build + push bridge to GHCR
	docker buildx build apps/bridge \
		--platform $(PLATFORM) \
		-t $(BRIDGE_IMG):$(BRIDGE_VER) \
		-t $(BRIDGE_IMG):sha-$(GIT_SHA) \
		-t $(BRIDGE_IMG):latest \
		--push
	@echo "✓ Pushed $(BRIDGE_IMG):$(BRIDGE_VER)"

push-ticketing-agent: ## Build + push ticketing-agent to GHCR
	docker buildx build apps/ticketing-agent \
		--platform $(PLATFORM) \
		-t $(TICKETING_AGENT_IMG):$(TICKETING_AGENT_VER) \
		-t $(TICKETING_AGENT_IMG):sha-$(GIT_SHA) \
		-t $(TICKETING_AGENT_IMG):latest \
		--push
	@echo "✓ Pushed $(TICKETING_AGENT_IMG):$(TICKETING_AGENT_VER)"

push-agent: ## Build + push agent to GHCR
	docker buildx build apps/agent \
		--platform $(PLATFORM) \
		-t $(AGENT_IMG):$(AGENT_VER) \
		-t $(AGENT_IMG):sha-$(GIT_SHA) \
		-t $(AGENT_IMG):latest \
		--push
	@echo "✓ Pushed $(AGENT_IMG):$(AGENT_VER)"

push-all: push-dashboard push-bridge push-ticketing-agent push-agent ## Build + push all images to GHCR

scan-dashboard: build-dashboard ## Scan dashboard image for vulnerabilities
	trivy image --severity CRITICAL,HIGH --ignore-unfixed $(DASHBOARD_IMG):latest

scan-bridge: build-bridge ## Scan bridge image for vulnerabilities
	trivy image --severity CRITICAL,HIGH --ignore-unfixed $(BRIDGE_IMG):latest

scan-ticketing-agent: build-ticketing-agent ## Scan ticketing-agent image for vulnerabilities
	trivy image --severity CRITICAL,HIGH --ignore-unfixed $(TICKETING_AGENT_IMG):latest

scan-agent: build-agent ## Scan agent image for vulnerabilities
	trivy image --severity CRITICAL,HIGH --ignore-unfixed $(AGENT_IMG):latest

scan-all: scan-dashboard scan-bridge scan-ticketing-agent scan-agent ## Scan all images

kind-load-dashboard: ## Load dashboard image into Kind cluster
	docker save $(DASHBOARD_IMG):latest | \
		docker exec -i $(KIND_CLUSTER)-control-plane \
		ctr -n k8s.io images import --all-platforms -
	@echo "✓ Loaded $(DASHBOARD_IMG):latest into Kind"

kind-load-bridge: ## Load bridge image into Kind cluster
	docker save $(BRIDGE_IMG):latest | \
		docker exec -i $(KIND_CLUSTER)-control-plane \
		ctr -n k8s.io images import --all-platforms -
	@echo "✓ Loaded $(BRIDGE_IMG):latest into Kind"

kind-load-ticketing-agent: ## Load ticketing-agent image into Kind cluster
	docker save $(TICKETING_AGENT_IMG):latest | \
		docker exec -i $(KIND_CLUSTER)-control-plane \
		ctr -n k8s.io images import --all-platforms -
	@echo "✓ Loaded $(TICKETING_AGENT_IMG):latest into Kind"

kind-load-agent: ## Load agent image into Kind cluster
	docker save $(AGENT_IMG):latest | \
		docker exec -i $(KIND_CLUSTER)-control-plane \
		ctr -n k8s.io images import --all-platforms -
	@echo "✓ Loaded $(AGENT_IMG):latest into Kind"

kind-load-all: kind-load-dashboard kind-load-bridge kind-load-ticketing-agent kind-load-agent ## Load all images into Kind
