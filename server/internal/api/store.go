package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	_ "modernc.org/sqlite"
	"review/server/migrations"
)

var phonePattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)
var cnMobilePattern = regexp.MustCompile(`^1[3-9][0-9]{9}$`)

func normalize(value string) (string, string, error) {
	value = strings.TrimSpace(value)
	// 11 位中国大陆手机号可以不写区号，统一存成 +86 开头。
	if digits := strings.NewReplacer(" ", "", "-", "").Replace(value); cnMobilePattern.MatchString(digits) {
		return "phone", "+86" + digits, nil
	} else if strings.HasPrefix(digits, "+") && phonePattern.MatchString(digits) {
		value = digits
	}
	if phonePattern.MatchString(value) {
		return "phone", value, nil
	}
	address, err := mail.ParseAddress(value)
	if err != nil || address.Address != value || len(value) > 254 || !strings.Contains(value, "@") {
		return "", "", errors.New("请输入邮箱或带国际区号的手机号（如 +86…）")
	}
	for _, c := range value {
		if c > 127 {
			return "", "", errors.New("暂只支持英文邮箱地址")
		}
	}
	return "email", strings.ToLower(value), nil
}
func Open(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	dsn := (&url.URL{Scheme: "file", Path: absolute}).String() + "?_pragma=foreign_keys%281%29&_pragma=busy_timeout%285000%29"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// A single connection serializes this small system's writers and applies PRAGMAs consistently.
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;`); err != nil {
		db.Close()
		return nil, err
	}
	if _, err = db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);`); err != nil {
		db.Close()
		return nil, err
	}
	var version int
	if err = db.QueryRow(`SELECT COALESCE(MAX(version),0) FROM schema_migrations`).Scan(&version); err != nil {
		db.Close()
		return nil, err
	}
	if version > 2 {
		db.Close()
		return nil, errors.New("database schema newer than application")
	}
	for _, migration := range []struct {
		version int
		name    string
	}{{1, "001_accounts.sql"}, {2, "002_progress.sql"}} {
		if version >= migration.version {
			continue
		}
		contents, e := migrations.Files.ReadFile(migration.name)
		if e != nil {
			db.Close()
			return nil, e
		}
		tx, e := db.Begin()
		if e != nil {
			db.Close()
			return nil, e
		}
		if _, e = tx.Exec(string(contents)); e == nil {
			_, e = tx.Exec(`INSERT INTO schema_migrations(version) VALUES(?)`, migration.version)
		}
		if e == nil {
			e = tx.Commit()
		} else {
			tx.Rollback()
		}
		if e != nil {
			db.Close()
			return nil, e
		}
	}
	if err = os.Chmod(path, 0600); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// CreateUser is an operator-only bootstrap. It never exposes an unauthenticated HTTP bypass.
// mustChange marks the password as initial so the first login has to change it.
func CreateUser(ctx context.Context, db *sql.DB, identifier, password string, mustChange bool) error {
	kind, value, err := normalize(identifier)
	if err != nil {
		return err
	}
	if !validPassword(password) {
		return errors.New("password must be 6+ characters and at most 256 bytes")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	id := randomToken()
	if _, err = tx.ExecContext(ctx, `INSERT INTO users(id,password_hash,created_at,must_change_password) VALUES(?,?,?,?)`, id, hashPassword(password), time.Now().Unix(), mustChange); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO user_identities(user_id,kind,normalized_value,verified_at) VALUES(?,?,?,?)`, id, kind, value, time.Now().Unix()); err != nil {
		return fmt.Errorf("create identity: %w", err)
	}
	return tx.Commit()
}
