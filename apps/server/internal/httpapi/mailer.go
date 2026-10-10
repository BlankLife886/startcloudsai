package httpapi

import (
	"crypto/tls"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

// smtpSendTimeout bounds one whole delivery, so a stalled mail server cannot
// hold a goroutine forever.
const smtpSendTimeout = 30 * time.Second

func (s *Server) smtpConfigured() bool {
	return s != nil && s.Cfg != nil && strings.TrimSpace(s.Cfg.SMTPAddr) != "" && strings.TrimSpace(s.Cfg.SMTPFrom) != ""
}

func sanitizeMailHeader(value string) string {
	return strings.TrimSpace(strings.NewReplacer("\r", "", "\n", "").Replace(value))
}

func mailEnvelopeAddress(value string) (string, error) {
	parsed, err := mail.ParseAddress(strings.TrimSpace(value))
	if err != nil {
		return "", err
	}
	return parsed.Address, nil
}

func (s *Server) sendPlainEmail(to, subject, body string) error {
	if !s.smtpConfigured() {
		if s != nil && s.Cfg != nil && s.Cfg.AppEnv == "development" {
			return nil
		}
		return fmt.Errorf("SMTP 未配置")
	}

	toAddress, err := mailEnvelopeAddress(to)
	if err != nil {
		return fmt.Errorf("invalid recipient: %w", err)
	}
	fromAddress, err := mailEnvelopeAddress(s.Cfg.SMTPFrom)
	if err != nil {
		return fmt.Errorf("invalid sender: %w", err)
	}
	host := s.Cfg.SMTPAddr
	if colon := strings.LastIndex(host, ":"); colon > 0 {
		host = host[:colon]
	}
	var smtpAuth smtp.Auth
	if s.Cfg.SMTPUser != "" {
		smtpAuth = smtp.PlainAuth("", s.Cfg.SMTPUser, s.Cfg.SMTPPassword, host)
	}
	encodedSubject := mime.QEncoding.Encode("UTF-8", sanitizeMailHeader(subject))
	message := []byte(
		"From: " + sanitizeMailHeader(s.Cfg.SMTPFrom) + "\r\n" +
			"To: " + sanitizeMailHeader(toAddress) + "\r\n" +
			"Subject: " + encodedSubject + "\r\n" +
			"MIME-Version: 1.0\r\n" +
			"Content-Type: text/plain; charset=UTF-8\r\n" +
			"Content-Transfer-Encoding: 8bit\r\n\r\n" +
			strings.ReplaceAll(body, "\n", "\r\n"),
	)
	return sendSMTP(s.Cfg.SMTPAddr, host, smtpAuth, fromAddress, toAddress, message)
}

// sendSMTP is smtp.SendMail with a deadline. Port 465 uses implicit TLS;
// other ports upgrade with STARTTLS when the server offers it.
func sendSMTP(addr, host string, auth smtp.Auth, from, to string, message []byte) error {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var conn net.Conn
	var err error
	if strings.HasSuffix(addr, ":465") {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{ServerName: host})
	} else {
		conn, err = dialer.Dial("tcp", addr)
	}
	if err != nil {
		return err
	}
	_ = conn.SetDeadline(time.Now().Add(smtpSendTimeout))
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return err
	}
	defer client.Close()
	if _, implicitTLS := conn.(*tls.Conn); !implicitTLS {
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err := client.StartTLS(&tls.Config{ServerName: host}); err != nil {
				return err
			}
		}
	}
	if auth != nil {
		if ok, _ := client.Extension("AUTH"); ok {
			if err := client.Auth(auth); err != nil {
				return err
			}
		}
	}
	if err := client.Mail(from); err != nil {
		return err
	}
	if err := client.Rcpt(to); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := writer.Write(message); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}
