package api

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"time"
)

//go:embed content/grade3b.json
var deckJSON []byte

const supportedDeck = "textbooks/minjiao/english/grade3b-words"

var mutationPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

type prefState struct {
	Unit    int    `json:"unit"`
	Lesson  int    `json:"lesson"`
	Dir     int    `json:"dir"`
	PeekAll bool   `json:"peekAll"`
	Sound   bool   `json:"sound"`
	LastKey string `json:"lastKey,omitempty"`
	LastIdx int    `json:"lastIdx,omitempty"`
}
type progressState struct {
	Status map[string]string `json:"status"`
	Pref   *prefState        `json:"pref"`
}
type snapshot struct {
	DeckKey       string          `json:"deckKey"`
	Revision      int64           `json:"revision"`
	SchemaVersion int             `json:"schemaVersion"`
	Payload       json.RawMessage `json:"payload"`
	UpdatedAt     string          `json:"updatedAt"`
}
type progressInput struct {
	BaseRevision  int64           `json:"baseRevision"`
	MutationID    string          `json:"mutationId"`
	SchemaVersion int             `json:"schemaVersion"`
	Payload       json.RawMessage `json:"payload"`
	Reason        string          `json:"reason"`
}

func (s *Server) progressPrincipal(r *http.Request) (principal, error) {
	p, err := s.principal(r)
	if err != nil {
		return p, err
	}
	if p.user.MustChangePassword {
		return p, &apiError{403, "password_change_required", "请先修改初始密码，再同步学习进度"}
	}
	return p, nil
}
func checkDeck(key string) error {
	if _, ok := contentDecks[key]; !ok {
		return bad("当前教材尚未开放同步")
	}
	return nil
}
func readSnapshot(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, user, key string) (snapshot, error) {
	out := snapshot{DeckKey: key, SchemaVersion: 1}
	var raw string
	err := q.QueryRowContext(ctx, `SELECT payload_json,revision,schema_version,updated_at FROM progress WHERE user_id=? AND deck_key=?`, user, key).Scan(&raw, &out.Revision, &out.SchemaVersion, &out.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	out.Payload = json.RawMessage(raw)
	return out, nil
}
func (s *Server) getProgress(w http.ResponseWriter, r *http.Request) error {
	p, err := s.progressPrincipal(r)
	if err != nil {
		return err
	}
	if err = s.rate(r, "progress-read", 240); err != nil {
		return err
	}
	key := r.URL.Query().Get("deckKey")
	if key != "" {
		if err = checkDeck(key); err != nil {
			return err
		}
		out, err := readSnapshot(r.Context(), s.db, p.user.ID, key)
		if err != nil {
			return err
		}
		return send(w, 200, out)
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT deck_key,revision,schema_version,updated_at FROM progress WHERE user_id=? ORDER BY deck_key`, p.user.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	type summary struct {
		DeckKey       string `json:"deckKey"`
		Revision      int64  `json:"revision"`
		SchemaVersion int    `json:"schemaVersion"`
		UpdatedAt     string `json:"updatedAt"`
	}
	summaries := []summary{}
	for rows.Next() {
		var item summary
		if err = rows.Scan(&item.DeckKey, &item.Revision, &item.SchemaVersion, &item.UpdatedAt); err != nil {
			return err
		}
		summaries = append(summaries, item)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	return send(w, 200, map[string]any{"decks": summaries})
}
func (s *Server) putProgress(w http.ResponseWriter, r *http.Request) error {
	p, err := s.progressPrincipal(r)
	if err != nil {
		return err
	}
	if err = s.rate(r, "progress-write", 120); err != nil {
		return err
	}
	key := r.URL.Query().Get("deckKey")
	if err = checkDeck(key); err != nil {
		return err
	}
	var in progressInput
	if err = decode(w, r, &in); err != nil {
		return err
	}
	if in.BaseRevision < 0 || in.BaseRevision >= 9007199254740991 || in.SchemaVersion != 1 || !mutationPattern.MatchString(in.MutationID) {
		return bad("进度版本或请求标识不正确")
	}
	if in.Reason == "" {
		in.Reason = "update"
	}
	switch in.Reason {
	case "update", "import", "reset", "restore", "conflict", "guest":
	default:
		return bad("更新原因不正确")
	}
	if in.Payload, err = validateDeckProgress(key, in.Payload); err != nil {
		return err
	}
	canonical, _ := json.Marshal(struct {
		DeckKey string
		Input   progressInput
	}{key, in})
	requestHash := tokenHash(string(canonical))
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Check authorization again while serialized with logout, reset and password change.
	var authorized int
	if err = tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active' AND u.must_change_password=0`, p.token, time.Now().Unix()).Scan(&authorized); err != nil {
		return err
	}
	if authorized != 1 {
		return unauthorized()
	}
	var priorHash, resultJSON string
	err = tx.QueryRowContext(r.Context(), `SELECT request_hash,result_json FROM progress_mutations WHERE user_id=? AND mutation_id=?`, p.user.ID, in.MutationID).Scan(&priorHash, &resultJSON)
	if err == nil {
		if priorHash != requestHash {
			return &apiError{409, "mutation_reused", "请求标识已用于不同内容"}
		}
		var result snapshot
		if err = json.Unmarshal([]byte(resultJSON), &result); err != nil {
			return err
		}
		return send(w, 200, result)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	before, err := readSnapshot(r.Context(), tx, p.user.ID, key)
	if err != nil {
		return err
	}
	if before.Revision != in.BaseRevision {
		return send(w, 409, map[string]any{"error": map[string]string{"code": "revision_conflict", "message": "服务器已有新进度，请选择保留哪一份"}, "current": before})
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if before.Revision > 0 {
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO progress_backups(user_id,deck_key,reason,payload_json,revision,created_at) VALUES(?,?,?,?,?,?)`, p.user.ID, key, in.Reason, string(before.Payload), before.Revision, now); err != nil {
			return err
		}
		if _, err = tx.ExecContext(r.Context(), `DELETE FROM progress_backups WHERE user_id=? AND deck_key=? AND id NOT IN (SELECT id FROM progress_backups WHERE user_id=? AND deck_key=? ORDER BY id DESC LIMIT 10)`, p.user.ID, key, p.user.ID, key); err != nil {
			return err
		}
	}
	after := snapshot{DeckKey: key, Revision: before.Revision + 1, SchemaVersion: 1, Payload: in.Payload, UpdatedAt: now}
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO progress(user_id,deck_key,payload_json,revision,schema_version,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,deck_key) DO UPDATE SET payload_json=excluded.payload_json,revision=excluded.revision,schema_version=excluded.schema_version,updated_at=excluded.updated_at`, p.user.ID, key, string(in.Payload), after.Revision, 1, now); err != nil {
		return err
	}
	result, _ := json.Marshal(after)
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO progress_mutations(user_id,mutation_id,request_hash,deck_key,result_json,created_at) VALUES(?,?,?,?,?,?)`, p.user.ID, in.MutationID, requestHash, key, string(result), now); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return send(w, 200, after)
}
func (s *Server) listBackups(w http.ResponseWriter, r *http.Request) error {
	p, err := s.progressPrincipal(r)
	if err != nil {
		return err
	}
	key := r.URL.Query().Get("deckKey")
	if err = checkDeck(key); err != nil {
		return err
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT id,reason,revision,created_at FROM progress_backups WHERE user_id=? AND deck_key=? ORDER BY id DESC LIMIT 10`, p.user.ID, key)
	if err != nil {
		return err
	}
	defer rows.Close()
	type backup struct {
		ID        int64  `json:"id"`
		Reason    string `json:"reason"`
		Revision  int64  `json:"revision"`
		CreatedAt string `json:"createdAt"`
	}
	items := []backup{}
	for rows.Next() {
		var item backup
		if err = rows.Scan(&item.ID, &item.Reason, &item.Revision, &item.CreatedAt); err != nil {
			return err
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	return send(w, 200, map[string]any{"backups": items})
}
func (s *Server) getBackup(w http.ResponseWriter, r *http.Request) error {
	p, err := s.progressPrincipal(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		return bad("备份标识不正确")
	}
	var out snapshot
	var raw string
	err = s.db.QueryRowContext(r.Context(), `SELECT deck_key,payload_json,revision,created_at FROM progress_backups WHERE user_id=? AND id=?`, p.user.ID, id).Scan(&out.DeckKey, &raw, &out.Revision, &out.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return &apiError{404, "not_found", "备份不存在"}
	}
	if err != nil {
		return err
	}
	out.SchemaVersion = 1
	out.Payload = json.RawMessage(raw)
	return send(w, 200, out)
}
