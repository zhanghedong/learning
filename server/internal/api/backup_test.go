package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestConsistentBackupRestore(t *testing.T) {
	source, err := Open(filepath.Join(t.TempDir(), "live.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	if err = CreateUser(context.Background(), source, "backup@example.com", "long-backup-password", true); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "backup.db")
	if err = Backup(context.Background(), source, destination); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(destination)
	if info.Mode().Perm() != 0600 {
		t.Fatal("backup permissions", info.Mode())
	}
	if err = Backup(context.Background(), source, destination); err == nil {
		t.Fatal("overwrote backup")
	}
	restored, err := Open(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	var n int
	var check string
	if err = restored.QueryRow("PRAGMA integrity_check").Scan(&check); err != nil || check != "ok" {
		t.Fatal(check, err)
	}
	if err = restored.QueryRow("SELECT COUNT(*) FROM users").Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
}
