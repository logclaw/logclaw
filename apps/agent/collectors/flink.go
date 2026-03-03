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

var flinkGVR = schema.GroupVersionResource{
	Group:    "flink.apache.org",
	Version:  "v1beta1",
	Resource: "flinkdeployments",
}

// FlinkJob represents the health of one Flink job deployment.
type FlinkJob struct {
	Name     string `json:"name"`
	State    string `json:"state"`
	Restarts int    `json:"restarts"`
}

// FlinkJobs reads all FlinkDeployment CRs in the namespace and returns their job states.
func FlinkJobs(ctx context.Context, namespace string) ([]FlinkJob, error) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("in-cluster config: %w", err)
	}

	client, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("dynamic client: %w", err)
	}

	list, err := client.Resource(flinkGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list FlinkDeployment CRs: %w", err)
	}

	var jobs []FlinkJob

	for _, item := range list.Items {
		name := item.GetName()

		statusRaw, ok := item.Object["status"]
		if !ok {
			jobs = append(jobs, FlinkJob{Name: name, State: "UNKNOWN"})
			continue
		}

		statusBytes, _ := json.Marshal(statusRaw)
		var status struct {
			JobStatus struct {
				State        string `json:"state"`
				UpgradeSavepointPath string `json:"upgradeSavepointPath"`
			} `json:"jobStatus"`
			ReconciliationStatus struct {
				LastReconciledSpec string `json:"lastReconciledSpec"`
			} `json:"reconciliationStatus"`
		}

		if err := json.Unmarshal(statusBytes, &status); err != nil {
			jobs = append(jobs, FlinkJob{Name: name, State: "UNKNOWN"})
			continue
		}

		state := status.JobStatus.State
		if state == "" {
			state = "UNKNOWN"
		}

		jobs = append(jobs, FlinkJob{
			Name:     name,
			State:    state,
			Restarts: 0, // Flink Operator does not expose restart count in CR status; use 0
		})
	}

	return jobs, nil
}
