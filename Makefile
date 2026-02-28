SHELL        := /bin/bash
.DEFAULT_GOAL := help

CHARTS_DIR    := charts
TENANT_ID     ?= dev-local
NAMESPACE     := logclaw-$(TENANT_ID)
STORAGE_CLASS ?= standard
HELM          := helm
CT            := ct
KIND          := kind
KIND_CLUSTER  := logclaw-dev

.PHONY: help deps lint lint-umbrella validate-schema template template-diff \
        kind-create kind-delete install-operators install uninstall test \
        ct-install package push clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

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

kind-create: ## Create local kind cluster
	$(KIND) create cluster --name $(KIND_CLUSTER) --wait 60s
	kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.1/cert-manager.crds.yaml --server-side || true
	@echo "Kind cluster $(KIND_CLUSTER) ready"

kind-delete: ## Delete local kind cluster
	$(KIND) delete cluster --name $(KIND_CLUSTER)

install-operators: ## Install cluster-level operators
	TENANT_ID=$(TENANT_ID) helmfile --file helmfile.d/00-operators.yaml apply

install: deps ## Install full tenant stack
	TENANT_ID=$(TENANT_ID) STORAGE_CLASS=$(STORAGE_CLASS) helmfile apply

uninstall: ## Uninstall tenant (WARNING: destructive)
	$(HELM) uninstall logclaw-$(TENANT_ID) --namespace $(NAMESPACE) || true
	kubectl delete namespace $(NAMESPACE) --ignore-not-found=true

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
