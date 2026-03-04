package collectors

import (
	"context"
	"encoding/json"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

var opensearchGVR = schema.GroupVersionResource{
	Group:    "opensearch.opster.io",
	Version:  "v1",
	Resource: "opensearchclusters",
}

// OSHealth summarises the OpenSearch cluster health from the CR status.
type OSHealth struct {
	Status           string `json:"status"`
	NumberOfNodes    int    `json:"numberOfNodes"`
	NumberOfDataNodes int   `json:"numberOfDataNodes"`
}

// OpenSearchHealth reads the first OpenSearchCluster CR in the namespace.
func OpenSearchHealth(ctx context.Context, namespace string) (OSHealth, error) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		return OSHealth{Status: "unknown"}, fmt.Errorf("in-cluster config: %w", err)
	}

	client, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return OSHealth{Status: "unknown"}, fmt.Errorf("dynamic client: %w", err)
	}

	list, err := client.Resource(opensearchGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return OSHealth{Status: "unknown"}, fmt.Errorf("list OpenSearchCluster CRs: %w", err)
	}

	if len(list.Items) == 0 {
		return OSHealth{Status: "unknown"}, nil
	}

	item := list.Items[0]
	statusRaw, ok := item.Object["status"]
	if !ok {
		return OSHealth{Status: "unknown"}, nil
	}

	statusBytes, _ := json.Marshal(statusRaw)
	var status struct {
		Health struct {
			Status           string `json:"status"`
			NumberOfNodes    int    `json:"numberOfNodes"`
			NumberOfDataNodes int   `json:"numberOfDataNodes"`
		} `json:"health"`
		// Opster operator also uses .status.cluster.health
		Cluster struct {
			Health string `json:"health"`
		} `json:"cluster"`
	}

	if err := json.Unmarshal(statusBytes, &status); err != nil {
		return OSHealth{Status: "unknown"}, nil
	}

	h := status.Health.Status
	if h == "" {
		h = status.Cluster.Health
	}
	if h == "" {
		h = "unknown"
	}

	return OSHealth{
		Status:           h,
		NumberOfNodes:    status.Health.NumberOfNodes,
		NumberOfDataNodes: status.Health.NumberOfDataNodes,
	}, nil
}
