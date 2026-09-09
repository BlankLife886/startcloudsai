package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
	"github.com/BlankLife886/startcloudsai/server/internal/taskflow"
	"github.com/hibiken/asynq"
)

// Run inside the worker container: require both live consumers on this host,
// not a startup log or a heartbeat left by a different release/container.
func checkWorker(cfg *config.Config) error {
	opt, err := asynq.ParseRedisURI(cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("invalid worker Redis configuration")
	}
	i := asynq.NewInspector(opt)
	defer i.Close()
	servers, err := i.Servers()
	if err != nil {
		return fmt.Errorf("cannot read worker heartbeats")
	}
	host, err := os.Hostname()
	if err != nil {
		return err
	}
	if !workerPoolsReady(servers, host) {
		return fmt.Errorf("image/chat consumers are not both active on this container")
	}
	for _, name := range []string{taskflow.QueueDefault, taskflow.QueueAssistantChat, taskflow.QueueAssistantImage} {
		q, err := i.GetQueueInfo(name)
		if errors.Is(err, asynq.ErrQueueNotFound) {
			continue
		} // Never-used queues need no backlog key.
		if err != nil || q.Paused {
			return fmt.Errorf("queue %s is unavailable or paused", name)
		}
	}
	fmt.Println("WORKER_POOLS_READY image=true chat=true")
	return nil
}

func workerPoolsReady(servers []*asynq.ServerInfo, host string) bool {
	image, chat := false, false
	for _, s := range servers {
		if s == nil || s.Host != host || s.Status != "active" || s.Concurrency < 1 {
			continue
		}
		image = image || (s.Queues[taskflow.QueueDefault] > 0 && s.Queues[taskflow.QueueAssistantImage] > 0)
		chat = chat || s.Queues[taskflow.QueueAssistantChat] > 0
	}
	return image && chat
}
