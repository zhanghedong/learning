package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type mailbox struct {
	mu    sync.Mutex
	codes map[string]string
}

func (m *mailbox) Send(_ context.Context, to, code string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.codes[to] = code
	return nil
}
func (m *mailbox) code(to string) string { m.mu.Lock(); defer m.mu.Unlock(); return m.codes[to] }

type fixture struct {
	t       *testing.T
	db      *sql.DB
	s       *Server
	handler http.Handler
	mail    *mailbox
}

func setup(t *testing.T) *fixture {
	t.Helper()
	db, err := Open(filepath.Join(t.TempDir(), "review.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	m := &mailbox{codes: map[string]string{}}
	s, err := New(db, Config{Sender: m, CodeSecret: strings.Repeat("s", 32)})
	if err != nil {
		t.Fatal(err)
	}
	return &fixture{t, db, s, s.Handler(), m}
}
func (f *fixture) request(method, path, token string, body any, status int) map[string]any {
	f.t.Helper()
	raw, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	if w.Code != status {
		f.t.Fatalf("%s %s: got %d want %d: %s", method, path, w.Code, status, w.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		f.t.Fatal(err)
	}
	return out
}
func (f *fixture) challenge(identifier, purpose, token string) (string, string) {
	f.t.Helper()
	out := f.request("POST", "/api/v1/auth/challenges", token, map[string]string{"identifier": identifier, "purpose": purpose}, 200)
	return out["challengeId"].(string), f.mail.code(strings.ToLower(identifier))
}
func (f *fixture) register(email string) {
	f.t.Helper()
	id, code := f.challenge(email, "register", "")
	f.request("POST", "/api/v1/auth/register", "", map[string]string{"identifier": email, "password": "test-password-123", "challengeId": id, "code": code}, 201)
}
func (f *fixture) login(identifier, password string) map[string]any {
	return f.request("POST", "/api/v1/auth/login", "", map[string]string{"identifier": identifier, "password": password}, 200)
}
func TestAccountsIsolationAndRevocation(t *testing.T) {
	f := setup(t)
	f.register("alice@example.com")
	f.register("bob@example.com")
	a := f.login("ALICE@example.com", "test-password-123")
	b := f.login("bob@example.com", "test-password-123")
	at, bt := a["token"].(string), b["token"].(string)
	au := f.request("GET", "/api/v1/me", at, nil, 200)
	bu := f.request("GET", "/api/v1/me", bt, nil, 200)
	if au["id"] == bu["id"] || au["email"] != "alice@example.com" || bu["email"] != "bob@example.com" {
		t.Fatal("account isolation failed")
	}
	f.request("GET", "/api/v1/me?userId="+bu["id"].(string), at, nil, 200)
	f.request("GET", "/api/v1/me", "", nil, 401)
	f.request("POST", "/api/v1/auth/login", "", map[string]string{"identifier": "alice@example.com", "password": "wrong-password-123"}, 401)
	var stored string
	f.db.QueryRow(`SELECT password_hash FROM users WHERE id=?`, au["id"]).Scan(&stored)
	if !strings.HasPrefix(stored, "$argon2id$") {
		t.Fatal("password not hashed")
	}
	var rawTokenCount int
	f.db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE token_hash=?`, at).Scan(&rawTokenCount)
	if rawTokenCount != 0 {
		t.Fatal("raw token stored")
	}
	f.request("POST", "/api/v1/auth/logout", at, nil, 200)
	f.request("GET", "/api/v1/me", at, nil, 401)
	f.request("GET", "/api/v1/me", bt, nil, 200)
}
func TestChallengeAttemptsExpiryAndPurpose(t *testing.T) {
	f := setup(t)
	id, code := f.challenge("one@example.com", "register", "")
	payload := map[string]string{"identifier": "one@example.com", "password": "test-password-123", "challengeId": id, "code": code}
	f.request("POST", "/api/v1/auth/reset-password", "", payload, 400)
	payload["code"] = "999999"
	if payload["code"] == code {
		payload["code"] = "000000"
	}
	for i := 0; i < 5; i++ {
		f.request("POST", "/api/v1/auth/register", "", payload, 400)
	}
	payload["code"] = code
	f.request("POST", "/api/v1/auth/register", "", payload, 400)
	id, code = f.challenge("two@example.com", "register", "")
	f.db.Exec(`UPDATE verification_challenges SET expires_at=? WHERE id=?`, time.Now().Add(-time.Minute).Unix(), id)
	payload["identifier"] = "two@example.com"
	payload["challengeId"] = id
	payload["code"] = code
	f.request("POST", "/api/v1/auth/register", "", payload, 400)
}
func TestPasswordChangeResetAndSingleUse(t *testing.T) {
	f := setup(t)
	f.register("one@example.com")
	f.register("two@example.com")
	one := f.login("one@example.com", "test-password-123")["token"].(string)
	other := f.login("one@example.com", "test-password-123")["token"].(string)
	f.request("POST", "/api/v1/auth/change-password", one, map[string]string{"oldPassword": "wrong-password-123", "password": "replacement-123"}, 400)
	f.request("POST", "/api/v1/auth/change-password", one, map[string]string{"oldPassword": "test-password-123", "password": "replacement-123"}, 200)
	f.request("GET", "/api/v1/me", one, nil, 401)
	f.request("GET", "/api/v1/me", other, nil, 401)
	one = f.login("one@example.com", "replacement-123")["token"].(string)
	// Permit another mail to the same test identity without waiting a real minute.
	f.s.mu.Lock()
	delete(f.s.buckets, "send:one@example.com")
	f.s.mu.Unlock()
	id, code := f.challenge("one@example.com", "reset", "")
	payload := map[string]string{"identifier": "one@example.com", "password": "after-reset-123", "challengeId": id, "code": code}
	f.request("POST", "/api/v1/auth/reset-password", "", payload, 200)
	f.request("POST", "/api/v1/auth/reset-password", "", payload, 400)
	f.request("GET", "/api/v1/me", one, nil, 401)
	f.login("one@example.com", "after-reset-123")
	f.login("two@example.com", "test-password-123")
}
func TestPhoneBootstrapAndBinding(t *testing.T) {
	f := setup(t)
	if err := CreateUser(context.Background(), f.db, "+8613800000000", "initial-password-123", true); err != nil {
		t.Fatal(err)
	}
	session := f.login("+8613800000000", "initial-password-123")
	token := session["token"].(string)
	if session["user"].(map[string]any)["mustChangePassword"] != true {
		t.Fatal("initial password not flagged")
	}
	f.request("POST", "/api/v1/auth/change-password", token, map[string]string{"oldPassword": "initial-password-123", "password": "changed-password-123"}, 200)
	token = f.login("+8613800000000", "changed-password-123")["token"].(string)
	id, code := f.challenge("bound@example.com", "bind", token)
	f.request("POST", "/api/v1/me/identities", token, map[string]string{"identifier": "bound@example.com", "challengeId": id, "code": code}, 200)
	email := f.login("bound@example.com", "changed-password-123")
	if email["user"].(map[string]any)["phone"] != "+8613800000000" {
		t.Fatal("binding produced another account")
	}
	f.request("POST", "/api/v1/auth/challenges", "", map[string]string{"identifier": "+8613900000000", "purpose": "register"}, 503)
}
func TestChinaMobileLoginWithShortPassword(t *testing.T) {
	f := setup(t)
	if err := CreateUser(context.Background(), f.db, "13800000123", "000123", false); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"13800000123", "+8613800000123", "138 0000 0123"} {
		session := f.login(id, "000123")
		user := session["user"].(map[string]any)
		if user["phone"] != "+8613800000123" || user["mustChangePassword"] != false {
			t.Fatal(id, user)
		}
	}
	token := f.login("13800000123", "000123")["token"].(string)
	path := "/api/v1/progress?deckKey=" + url.QueryEscape("textbooks/pep/chinese/grade8a-midterm-qa")
	f.request("PUT", path, token, map[string]any{"baseRevision": 0, "mutationId": "short-password-mutation-1", "schemaVersion": 1, "payload": []int{1}}, 400)
	out := f.request("PUT", path, token, map[string]any{"baseRevision": 0, "mutationId": "short-password-mutation-2", "schemaVersion": 1, "payload": map[string]any{"status": map[string]any{"cards": map[string]any{"sanxia": map[string]any{"box": 1}}}}}, 200)
	if out["revision"] != float64(1) {
		t.Fatal(out)
	}
	f.request("POST", "/api/v1/auth/login", "", map[string]string{"identifier": "13800000123", "password": "12345"}, 401)
}
func TestPersistenceAndMigrationGuard(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db.sqlite")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = CreateUser(context.Background(), db, "saved@example.com", "test-password-123", true); err != nil {
		t.Fatal(err)
	}
	s, _ := New(db, Config{CodeSecret: strings.Repeat("s", 32)})
	f := &fixture{t, db, s, s.Handler(), nil}
	token := f.login("saved@example.com", "test-password-123")["token"].(string)
	db.Close()
	db, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s, _ = New(db, Config{CodeSecret: strings.Repeat("s", 32)})
	f.db = db
	f.handler = s.Handler()
	f.request("GET", "/api/v1/me", token, nil, 200)
	db.Exec(`INSERT INTO schema_migrations(version) VALUES(99)`)
	db.Close()
	if db, err = Open(path); err == nil {
		db.Close()
		t.Fatal("accepted newer database")
	}
}
func TestLimitsAndDisabledDelivery(t *testing.T) {
	f := setup(t)
	f.s.config.Sender = nil
	f.request("GET", "/api/v1/auth/capabilities", "", nil, 200)
	f.request("POST", "/api/v1/auth/challenges", "", map[string]string{"identifier": "none@example.com", "purpose": "register"}, 503)
	f.request("POST", "/api/v1/auth/register", "", map[string]string{"identifier": "none@example.com", "password": "test-password-123"}, 503)
	f.request("POST", "/api/v1/auth/login", "", map[string]string{"identifier": "none@example.com", "password": strings.Repeat("a", 270000)}, 413)
	for i := 0; i < 10; i++ {
		f.request("POST", "/api/v1/auth/login", "", map[string]string{"identifier": "none@example.com", "password": "test-password-123"}, 401)
	}
	f.request("POST", "/api/v1/auth/login", "", map[string]string{"identifier": "none@example.com", "password": "test-password-123"}, 429)
}

func TestConcurrentChallengeConsumption(t *testing.T) {
	f := setup(t)
	id, code := f.challenge("concurrent@example.com", "register", "")
	payload, _ := json.Marshal(map[string]string{"identifier": "concurrent@example.com", "password": "concurrent-password", "challengeId": id, "code": code})
	results := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func() {
			r := httptest.NewRequest("POST", "/api/v1/auth/register", bytes.NewReader(payload))
			w := httptest.NewRecorder()
			f.handler.ServeHTTP(w, r)
			results <- w.Code
		}()
	}
	first, second := <-results, <-results
	if !((first == 201 && second == 400) || (first == 400 && second == 201)) {
		t.Fatalf("challenge reused concurrently: %d %d", first, second)
	}
	var count int
	f.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	if count != 1 {
		t.Fatal("duplicate account created")
	}
}
func TestSessionExpiryAndBoundChallengeOwnership(t *testing.T) {
	f := setup(t)
	for _, phone := range []string{"+8613800000001", "+8613800000002"} {
		if err := CreateUser(context.Background(), f.db, phone, "initial-password-123", true); err != nil {
			t.Fatal(err)
		}
	}
	a := f.login("+8613800000001", "initial-password-123")["token"].(string)
	b := f.login("+8613800000002", "initial-password-123")["token"].(string)
	f.db.Exec(`UPDATE users SET must_change_password=0`)
	id, code := f.challenge("owned@example.com", "bind", a)
	payload := map[string]string{"identifier": "owned@example.com", "challengeId": id, "code": code}
	f.request("POST", "/api/v1/me/identities", b, payload, 400)
	f.request("POST", "/api/v1/me/identities", a, payload, 200)
	f.db.Exec(`UPDATE sessions SET expires_at=? WHERE token_hash=?`, time.Now().Add(-time.Second).Unix(), tokenHash(a))
	f.request("GET", "/api/v1/me", a, nil, 401)
	f.request("GET", "/api/v1/me", b, nil, 200)
}
