package httpapi

import (
	"fmt"
	"mime"
	"net/mail"
	"net/smtp"
	"strings"
)

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
	return smtp.SendMail(s.Cfg.SMTPAddr, smtpAuth, fromAddress, []string{toAddress}, message)
}
