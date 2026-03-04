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

var kafkaGVR = schema.GroupVersionResource{
	Group:    "kafka.strimzi.io",
	Version:  "v1beta2",
	Resource: "kafkas",
}

// KafkaLag reads Strimzi Kafka CR status to extract consumer group lag per topic.
// The Strimzi operator exposes lag in the CR status under .status.kafkaConsumerGroups[].topics[].lag
// Falls back to zero map if the field is absent (e.g., Strimzi version doesn't expose it).
func KafkaLag(ctx context.Context, namespace string) (map[string]int64, error) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("in-cluster config: %w", err)
	}

	client, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("dynamic client: %w", err)
	}

	list, err := client.Resource(kafkaGVR).Namespace(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list Kafka CRs: %w", err)
	}

	result := make(map[string]int64)

	for _, item := range list.Items {
		statusRaw, ok := item.Object["status"]
		if !ok {
			continue
		}
		statusBytes, _ := json.Marshal(statusRaw)

		var status struct {
			KafkaConsumerGroups []struct {
				GroupID string `json:"groupId"`
				Topics  []struct {
					Topic string `json:"topic"`
					Lag   int64  `json:"lag"`
				} `json:"topics"`
			} `json:"kafkaConsumerGroups"`
		}

		if err := json.Unmarshal(statusBytes, &status); err != nil {
			continue
		}

		for _, cg := range status.KafkaConsumerGroups {
			for _, t := range cg.Topics {
				key := fmt.Sprintf("%s/%s", cg.GroupID, t.Topic)
				result[key] += t.Lag
			}
		}
	}

	return result, nil
}
