package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"review/server/internal/api"
	"syscall"
	"time"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func run() error {
	db, err := api.Open(env("REVIEW_DB", "data/review.db"))
	if err != nil {
		return err
	}
	defer db.Close()
	if len(os.Args) > 1 && os.Args[1] == "create-user" {
		mustChange := os.Getenv("REVIEW_BOOTSTRAP_MUST_CHANGE") != "0"
		err = api.CreateUser(context.Background(), db, os.Getenv("REVIEW_BOOTSTRAP_IDENTIFIER"), os.Getenv("REVIEW_BOOTSTRAP_PASSWORD"), mustChange)
		if err == nil && mustChange {
			slog.Info("account created; password change required on first login")
		} else if err == nil {
			slog.Info("account created")
		}
		return err
	}
	if len(os.Args) > 1 && os.Args[1] == "backup" {
		if len(os.Args) != 3 {
			return errors.New("usage: review-api backup ABSOLUTE_DESTINATION")
		}
		return api.Backup(context.Background(), db, os.Args[2])
	}
	config := api.Config{CodeSecret: os.Getenv("REVIEW_CODE_SECRET")}
	if address := os.Getenv("REVIEW_SMTP_ADDR"); address != "" {
		if os.Getenv("REVIEW_SMTP_FROM") == "" {
			return errors.New("REVIEW_SMTP_FROM required")
		}
		config.Sender = api.SMTPMailer{Address: address, Username: os.Getenv("REVIEW_SMTP_USER"), Password: os.Getenv("REVIEW_SMTP_PASSWORD"), From: os.Getenv("REVIEW_SMTP_FROM")}
	}
	service, err := api.New(db, config)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server := &http.Server{Addr: env("REVIEW_ADDR", "127.0.0.1:3108"), Handler: service.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := service.Cleanup(ctx); err != nil {
					slog.Error("security record cleanup failed")
				}
			}
		}
	}()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("review API listening", "address", server.Addr)
	err = server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
func main() {
	if err := run(); err != nil {
		slog.Error("review API stopped", "error", err)
		os.Exit(1)
	}
}
