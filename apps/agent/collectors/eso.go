package collectors

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

var externalSecretGVR = schema.GroupVersionResource{
	Group:    "external-secrets.io",
	Version:  "v1beta1",
	Resource: "externalsecrets",
}

// ESOExternalSecret represents the sync status of one ExternalSecret.
type ESOExternalSecret struct {
	Name     string `json:"name"`
	Ready    bool   `json:"ready"`
	LastSync string `json:"lastSync"`
}

// ESOStatus reads all ExternalSecret CRs in the namespace and returns their sync state.
func ESOStatus(ctx context.Context, namespace string) ([]ESOExternalSecret, error) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("in-cluster config: %w", err)
	}

	client, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("dynamic client: %w", err)
	}

	list, err := client.Resource(externalSecretGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list ExternalSecret CRs: %w", err)
	}

	var result []ESOExternalSecret

	for _, item := range list.Items {
		name := item.GetName()

		statusRaw, ok := item.Object["status"]
		if !ok {
			result = append(result, ESOExternalSecret{Name: name, Ready: false})
			continue
		}

		statusBytes, _ := json.Marshal(statusRaw)
		var status struct {
			Conditions []struct {
				Type   string `json:"type"`
				Status string `json:"status"`
			} `json:"conditions"`
			RefreshTime *metav1.Time `json:"refreshTime,omitempty"`
			SyncedResourceVersion string `json:"syncedResourceVersion"`
		}

		if err := json.Unmarshal(statusBytes, &status); err != nil {
			result = append(result, ESOExternalSecret{Name: name, Ready: false})
			continue
		}

		ready := false
		for _, c := range status.Conditions {
			if c.Type == "Ready" && c.Status == "True" {
				ready = true
				break
			}
		}

		lastSync := ""
		if status.RefreshTime != nil {
			lastSync = status.RefreshTime.UTC().Format(time.RFC3339)
		}

		result = append(result, ESOExternalSecret{
			Name:     name,
			Ready:    ready,
			LastSync: lastSync,
		})
	}

	return result, nil
}
