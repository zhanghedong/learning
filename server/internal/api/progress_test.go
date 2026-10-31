package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

var progressURL = "/api/v1/progress?deckKey=" + url.QueryEscape(supportedDeck)

func payload(mark string) map[string]any {
	return map[string]any{"status": map[string]string{"0|单词|kill": mark}, "pref": map[string]any{"unit": 0, "lesson": -1, "dir": 0, "sound": true, "peekAll": false}}
}
func mutation(id string, base int, mark string) map[string]any {
	return map[string]any{"mutationId": id, "baseRevision": base, "schemaVersion": 1, "payload": payload(mark), "reason": "update"}
}
func TestProgressIsolationCASAndIdempotency(t *testing.T) {
	f := setup(t)
	f.register("a@example.com")
	f.register("b@example.com")
	a := f.login("a@example.com", "test-password-123")["token"].(string)
	b := f.login("b@example.com", "test-password-123")["token"].(string)
	f.request("GET", progressURL, "", nil, 401)
	if out := f.request("GET", progressURL, a, nil, 200); out["revision"] != float64(0) || out["payload"] != nil {
		t.Fatal("missing progress must be explicit null")
	}
	input := mutation("first-mutation-0001", 0, "got")
	first := f.request("PUT", progressURL, a, input, 200)
	if first["revision"] != float64(1) {
		t.Fatal(first)
	}
	retry := f.request("PUT", progressURL, a, input, 200)
	if retry["updatedAt"] != first["updatedAt"] {
		t.Fatal("retry created new revision")
	}
	if empty := f.request("GET", progressURL, b, nil, 200); empty["payload"] != nil {
		t.Fatal("cross user read")
	}
	changed := mutation("first-mutation-0001", 0, "review")
	f.request("PUT", progressURL, a, changed, 409)
	conflict := f.request("PUT", progressURL, a, mutation("second-mutation-0001", 0, "review"), 409)
	if conflict["current"].(map[string]any)["revision"] != float64(1) {
		t.Fatal("conflict missing latest snapshot")
	}
	f.request("PUT", progressURL, a, mutation("second-mutation-0001", 1, "review"), 200)
	backup := f.request("GET", "/api/v1/progress/backups?deckKey="+url.QueryEscape(supportedDeck), a, nil, 200)["backups"].([]any)[0].(map[string]any)
	id := int(backup["id"].(float64))
	path := "/api/v1/progress/backups/" + jsonNumber(id)
	f.request("GET", path, b, nil, 404)
	saved := f.request("GET", path, a, nil, 200)
	if saved["payload"].(map[string]any)["status"].(map[string]any)["0|单词|kill"] != "got" {
		t.Fatal("backup content wrong")
	}
	summaries := f.request("GET", "/api/v1/progress", a, nil, 200)["decks"].([]any)
	if len(summaries) != 1 {
		t.Fatal(summaries)
	}
	// Same mutation ID belongs to each account independently.
	f.request("PUT", progressURL, b, input, 200)
}
func jsonNumber(i int) string { b, _ := json.Marshal(i); return string(b) }
func TestConcurrentProgressUpdates(t *testing.T) {
	f := setup(t)
	f.register("one@example.com")
	token := f.login("one@example.com", "test-password-123")["token"].(string)
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		raw, _ := json.Marshal(mutation("concurrent-write-"+jsonNumber(i), 0, "got"))
		go func() {
			r := httptest.NewRequest("PUT", progressURL, bytes.NewReader(raw))
			r.Header.Set("Authorization", "Bearer "+token)
			w := httptest.NewRecorder()
			f.handler.ServeHTTP(w, r)
			codes <- w.Code
		}()
	}
	a, b := <-codes, <-codes
	if !((a == 200 && b == 409) || (a == 409 && b == 200)) {
		t.Fatalf("lost update: %d/%d", a, b)
	}
	if out := f.request("GET", progressURL, token, nil, 200); out["revision"] != float64(1) {
		t.Fatal(out)
	}
}
func TestProgressValidationRevokedSessionAndBackupRetention(t *testing.T) {
	f := setup(t)
	f.register("one@example.com")
	token := f.login("one@example.com", "test-password-123")["token"].(string)
	f.request("PUT", "/api/v1/progress?deckKey=unknown", token, mutation("valid-mutation-0001", 0, "got"), 400)
	f.request("PUT", progressURL, token, mutation("valid-mutation-0001", 0, "bad-state"), 400)
	bad := mutation("valid-mutation-0001", 0, "got")
	bad["userId"] = "another-user"
	f.request("PUT", progressURL, token, bad, 400)
	bad = mutation("valid-mutation-0001", 0, "got")
	bad["schemaVersion"] = 2
	f.request("PUT", progressURL, token, bad, 400)
	for i := 0; i < 13; i++ {
		f.request("PUT", progressURL, token, mutation("valid-mutation-"+jsonNumber(1000+i), i, "got"), 200)
	}
	items := f.request("GET", "/api/v1/progress/backups?deckKey="+url.QueryEscape(supportedDeck), token, nil, 200)["backups"].([]any)
	if len(items) != 10 {
		t.Fatal("backup retention wrong")
	}
	// A replay still returns the original committed result, even after later writes.
	if out := f.request("PUT", progressURL, token, mutation("valid-mutation-1000", 0, "got"), 200); out["revision"] != float64(1) {
		t.Fatal(out)
	}
	f.request("POST", "/api/v1/auth/logout", token, map[string]any{}, 200)
	f.request("PUT", progressURL, token, mutation("valid-mutation-9000", 13, "got"), 401)
}
func TestProgressTransactionRollback(t *testing.T) {
	f := setup(t)
	f.register("one@example.com")
	token := f.login("one@example.com", "test-password-123")["token"].(string)
	f.request("PUT", progressURL, token, mutation("before-rollback-0001", 0, "got"), 200)
	_, err := f.db.Exec(`CREATE TRIGGER fail_mutation BEFORE INSERT ON progress_mutations BEGIN SELECT RAISE(ABORT,'test storage failure'); END`)
	if err != nil {
		t.Fatal(err)
	}
	f.request("PUT", progressURL, token, mutation("after-rollback-0001", 1, "review"), 500)
	if out := f.request("GET", progressURL, token, nil, 200); out["revision"] != float64(1) {
		t.Fatal("failed write changed progress")
	}
	if items := f.request("GET", "/api/v1/progress/backups?deckKey="+url.QueryEscape(supportedDeck), token, nil, 200)["backups"].([]any); len(items) != 0 {
		t.Fatal("backup not rolled back")
	}
}
func TestV1MigrationPreservesAccountsAndRejectsBootstrapProgress(t *testing.T) {
	path := filepath.Join(t.TempDir(), "existing.db")
	// Build a real P1 schema before opening it with the P2 migrator.
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = CreateUser(context.Background(), db, "old@example.com", "initial-password-123", true); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`DROP TABLE progress_mutations;DROP TABLE progress_backups;DROP TABLE progress;DELETE FROM schema_migrations WHERE version=2`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s, err := New(db, Config{CodeSecret: "test-only-secret-at-least-thirty-two-bytes"})
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, db: db, s: s, handler: s.Handler()}
	token := f.login("old@example.com", "initial-password-123")["token"].(string)
	f.request("GET", progressURL, token, nil, 403)
	f.request("POST", "/api/v1/auth/change-password", token, map[string]string{"oldPassword": "initial-password-123", "password": "changed-password-123"}, 200)
	token = f.login("old@example.com", "changed-password-123")["token"].(string)
	f.request("PUT", progressURL, token, mutation("persisted-after-v1", 0, "got"), 200)
	db.Close()
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	f.db = db
	s, _ = New(db, s.config)
	f.handler = s.Handler()
	if out := f.request("GET", progressURL, token, nil, 200); out["revision"] != float64(1) {
		t.Fatal("restart lost progress")
	}
}
func TestExtractedServerContentMatchesMobile(t *testing.T) {
	raw, err := os.ReadFile("../../../mobile/src/content/grade3b.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(raw, deckJSON) {
		t.Fatal("content differs between server and mobile")
	}
}
