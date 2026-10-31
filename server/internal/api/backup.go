package api

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
)

// Backup creates a consistent standalone SQLite snapshot, including committed WAL data.
// VACUUM INTO refuses existing destinations; it never replaces a prior backup.
func Backup(ctx context.Context, db *sql.DB, destination string) error {
	if !filepath.IsAbs(destination) {
		return errors.New("backup destination must be absolute")
	}
	if _, err := os.Lstat(destination); err == nil {
		return errors.New("backup destination already exists")
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	// Reserve the destination with owner-only permissions before SQLite writes it.
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	if _, err = db.ExecContext(ctx, "VACUUM INTO ?", destination); err != nil {
		_ = os.Remove(destination)
		return err
	}
	return nil
}
