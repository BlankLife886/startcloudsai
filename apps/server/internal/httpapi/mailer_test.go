package httpapi

import (
	"bufio"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/BlankLife886/startcloudsai/server/internal/config"
)

// fakeSMTP accepts one plain-text session and returns the DATA it received.
func fakeSMTP(t *testing.T) (string, <-chan string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	received := make(chan string, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		reader := bufio.NewReader(conn)
		write := func(line string) { _, _ = conn.Write([]byte(line + "\r\n")) }
		write("220 fake")
		var data strings.Builder
		inData := false
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			if inData {
				if line == ".\r\n" {
					inData = false
					received <- data.String()
					write("250 queued")
					continue
				}
				data.WriteString(line)
				continue
			}
			switch command := strings.ToUpper(strings.TrimSpace(line)); {
			case strings.HasPrefix(command, "EHLO"), strings.HasPrefix(command, "HELO"):
				write("250 fake")
			case command == "DATA":
				inData = true
				write("354 go ahead")
			case command == "QUIT":
				write("221 bye")
				return
			default:
				write("250 ok")
			}
		}
	}()
	return listener.Addr().String(), received
}

func TestSendPlainEmailDeliversThroughSMTP(t *testing.T) {
	addr, received := fakeSMTP(t)
	srv := &Server{Cfg: &config.Config{SMTPAddr: addr, SMTPFrom: "alerts@example.com"}}
	if err := srv.sendPlainEmail("ops@example.com", "支付监听端异常", "第一行\n第二行"); err != nil {
		t.Fatal(err)
	}
	select {
	case data := <-received:
		if !strings.Contains(data, "To: ops@example.com") || !strings.Contains(data, "第一行\r\n第二行") {
			t.Fatalf("unexpected message: %q", data)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no message delivered")
	}
}

func TestSendPlainEmailFailsFastWhenServerIsDown(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	listener.Close()
	srv := &Server{Cfg: &config.Config{SMTPAddr: addr, SMTPFrom: "alerts@example.com"}}
	if err := srv.sendPlainEmail("ops@example.com", "s", "b"); err == nil {
		t.Fatal("send to a closed port succeeded")
	}
}
