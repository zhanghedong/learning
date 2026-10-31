package api

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

type Sender interface {
	Send(context.Context, string, string) error
}

// SMTPMailer requires STARTTLS and verified server certificates (normally port 587).
type SMTPMailer struct{ Address, Username, Password, From string }

func (m SMTPMailer) Send(ctx context.Context, to, code string) error {
	host, _, err := net.SplitHostPort(m.Address)
	if err != nil {
		return err
	}
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", m.Address)
	if err != nil {
		return err
	}
	defer conn.Close()
	deadline := time.Now().Add(15 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	conn.SetDeadline(deadline)
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()
	if ok, _ := client.Extension("STARTTLS"); !ok {
		return fmt.Errorf("SMTP requires STARTTLS")
	}
	if err = client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
		return err
	}
	if m.Username != "" {
		if err = client.Auth(smtp.PlainAuth("", m.Username, m.Password, host)); err != nil {
			return err
		}
	}
	if strings.ContainsAny(m.From+to, "\r\n") {
		return fmt.Errorf("invalid email")
	}
	if err = client.Mail(m.From); err != nil {
		return err
	}
	if err = client.Rcpt(to); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(writer, "From: %s\r\nTo: %s\r\nSubject: Review verification code\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour Review verification code is %s. It expires in 10 minutes.\r\n", m.From, to, code)
	if err != nil {
		return err
	}
	if err = writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}
