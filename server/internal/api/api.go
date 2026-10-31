package api

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Config struct {
	Sender     Sender
	CodeSecret string
}
type Server struct {
	db      *sql.DB
	config  Config
	dummy   string
	mu      sync.Mutex
	buckets map[string]bucket
	work    chan struct{}
}
type bucket struct {
	count int
	until time.Time
}
type apiError struct {
	status        int
	code, message string
}

func (e *apiError) Error() string { return e.message }
func bad(message string) error    { return &apiError{400, "invalid_request", message} }
func unauthorized() error {
	return &apiError{401, "unauthorized", "登录已失效或账号密码不正确，请重新登录"}
}

type User struct {
	ID                 string `json:"id"`
	Email              string `json:"email,omitempty"`
	Phone              string `json:"phone,omitempty"`
	MustChangePassword bool   `json:"mustChangePassword"`
}
type principal struct {
	user        User
	hash, token string
}
type action func(http.ResponseWriter, *http.Request) error

func New(db *sql.DB, c Config) (*Server, error) {
	if len(c.CodeSecret) < 32 {
		return nil, errors.New("REVIEW_CODE_SECRET must contain at least 32 bytes")
	}
	return &Server{db: db, config: c, dummy: hashPassword(randomToken()), buckets: map[string]bucket{}, work: make(chan struct{}, 4)}, nil
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.wrap(func(w http.ResponseWriter, r *http.Request) error {
		if e := s.db.PingContext(r.Context()); e != nil {
			return e
		}
		return send(w, 200, map[string]bool{"ok": true})
	}))
	mux.HandleFunc("GET /api/v1/auth/capabilities", s.wrap(func(w http.ResponseWriter, r *http.Request) error {
		return send(w, 200, map[string]bool{"emailRegistration": s.config.Sender != nil, "emailRecovery": s.config.Sender != nil, "phoneRegistration": false})
	}))
	mux.HandleFunc("/", s.wrap(func(w http.ResponseWriter, r *http.Request) error {
		return &apiError{404, "not_found", "接口不存在"}
	}))
	mux.HandleFunc("POST /api/v1/auth/challenges", s.wrap(s.challenge))
	mux.HandleFunc("POST /api/v1/auth/register", s.wrap(s.register))
	mux.HandleFunc("POST /api/v1/auth/login", s.wrap(s.login))
	mux.HandleFunc("POST /api/v1/auth/logout", s.wrap(s.logout))
	mux.HandleFunc("GET /api/v1/progress", s.wrap(s.getProgress))
	mux.HandleFunc("PUT /api/v1/progress", s.wrap(s.putProgress))
	mux.HandleFunc("GET /api/v1/progress/backups", s.wrap(s.listBackups))
	mux.HandleFunc("GET /api/v1/progress/backups/{id}", s.wrap(s.getBackup))
	mux.HandleFunc("GET /api/v1/me", s.wrap(s.me))
	mux.HandleFunc("POST /api/v1/me/identities", s.wrap(s.bind))
	mux.HandleFunc("POST /api/v1/auth/change-password", s.wrap(s.changePassword))
	mux.HandleFunc("POST /api/v1/auth/reset-password", s.wrap(s.resetPassword))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := randomToken()
		start := time.Now()
		recorder := &responseRecorder{ResponseWriter: w, status: 200}
		w = recorder
		w.Header().Set("X-Request-ID", requestID)
		defer func() {
			slog.Info("http request", "request_id", requestID, "method", r.Method, "route", r.Pattern, "status", recorder.status, "duration_ms", time.Since(start).Milliseconds())
		}()
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		select {
		case s.work <- struct{}{}:
			defer func() { <-s.work }()
		default:
			writeError(w, &apiError{429, "busy", "请求较多，请稍后再试"})
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func send(w http.ResponseWriter, status int, value any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, err error) {
	var a *apiError
	if !errors.As(err, &a) {
		slog.Error("api operation failed")
		a = &apiError{500, "internal_error", "服务暂时不可用，请稍后重试"}
	}
	if a.status == 429 {
		w.Header().Set("Retry-After", "60")
	}
	_ = send(w, a.status, map[string]any{"error": map[string]string{"code": a.code, "message": a.message}})
}
func (s *Server) wrap(fn action) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			writeError(w, err)
		}
	}
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 256*1024)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			return &apiError{413, "too_large", "请求数据过大"}
		}
		return bad("请求格式不正确")
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		return bad("请求只能包含一个 JSON 对象")
	}
	return nil
}
func (s *Server) limit(key string, limit int, window time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if len(s.buckets) > 10000 {
		for k, b := range s.buckets {
			if now.After(b.until) {
				delete(s.buckets, k)
			}
		}
		if len(s.buckets) > 10000 {
			return &apiError{429, "rate_limited", "请求太频繁，请稍后重试"}
		}
	}
	b := s.buckets[key]
	if now.After(b.until) {
		b = bucket{until: now.Add(window)}
	}
	b.count++
	s.buckets[key] = b
	if b.count > limit {
		return &apiError{429, "rate_limited", "请求太频繁，请稍后重试"}
	}
	return nil
}
func (s *Server) rate(r *http.Request, action string, limit int) error {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return s.limit(action+":"+host, limit, time.Minute)
}
func (s *Server) principal(r *http.Request) (principal, error) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" || len(token) > 128 || !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		return principal{}, unauthorized()
	}
	p := principal{token: tokenHash(token)}
	err := s.db.QueryRowContext(r.Context(), `SELECT u.id,u.password_hash,u.must_change_password FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'`, p.token, time.Now().Unix()).Scan(&p.user.ID, &p.hash, &p.user.MustChangePassword)
	if errors.Is(err, sql.ErrNoRows) {
		return p, unauthorized()
	}
	if err != nil {
		return p, err
	}
	if err = s.identities(r.Context(), &p.user); err != nil {
		return p, err
	}
	return p, nil
}
func (s *Server) identities(ctx context.Context, u *User) error {
	rows, err := s.db.QueryContext(ctx, `SELECT kind,normalized_value FROM user_identities WHERE user_id=?`, u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var kind, value string
		if err = rows.Scan(&kind, &value); err != nil {
			return err
		}
		if kind == "phone" {
			u.Phone = value
		} else {
			u.Email = value
		}
	}
	return rows.Err()
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) error {
	p, err := s.principal(r)
	if err != nil {
		return err
	}
	return send(w, 200, p.user)
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) error {
	if err := s.rate(r, "login", 20); err != nil {
		return err
	}
	var in struct{ Identifier, Password string }
	if err := decode(w, r, &in); err != nil {
		return err
	}
	_, value, err := normalize(in.Identifier)
	if err != nil || !validPassword(in.Password) {
		return unauthorized()
	}
	if err = s.limit("login-id:"+value, 10, time.Minute); err != nil {
		return err
	}
	var u User
	var hash string
	err = s.db.QueryRowContext(r.Context(), `SELECT u.id,u.password_hash,u.must_change_password FROM users u JOIN user_identities i ON i.user_id=u.id WHERE i.normalized_value=? AND u.status='active'`, value).Scan(&u.ID, &hash, &u.MustChangePassword)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if hash == "" {
		hash = s.dummy
	}
	ok := checkPassword(hash, in.Password)
	if !ok || u.ID == "" {
		return unauthorized()
	}
	token := randomToken()
	expires := time.Now().Add(30 * 24 * time.Hour).Unix()
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,id,? FROM users WHERE id=? AND password_hash=? AND status='active'`, tokenHash(token), expires, u.ID, hash)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return unauthorized()
	}
	if err = s.identities(r.Context(), &u); err != nil {
		return err
	}
	return send(w, 200, map[string]any{"token": token, "expiresAt": expires, "user": u})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) error {
	p, err := s.principal(r)
	if err != nil {
		return err
	}
	if _, err = s.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE token_hash=?`, p.token); err != nil {
		return err
	}
	return send(w, 200, map[string]bool{"ok": true})
}
func (s *Server) codeHash(id, code string) string {
	m := hmac.New(sha256.New, []byte(s.config.CodeSecret))
	m.Write([]byte(id + ":" + code))
	return hex.EncodeToString(m.Sum(nil))
}
func (s *Server) challenge(w http.ResponseWriter, r *http.Request) error {
	if err := s.rate(r, "challenge", 10); err != nil {
		return err
	}
	var in struct{ Identifier, Purpose string }
	if err := decode(w, r, &in); err != nil {
		return err
	}
	kind, value, err := normalize(in.Identifier)
	if err != nil {
		return bad(err.Error())
	}
	if in.Purpose != "register" && in.Purpose != "reset" && in.Purpose != "bind" {
		return bad("验证码用途不正确")
	}
	if kind != "email" || s.config.Sender == nil {
		return &apiError{503, "delivery_unavailable", "该验证通道尚未配置，请使用已有账号登录"}
	}
	owner := ""
	if in.Purpose == "bind" {
		p, e := s.principal(r)
		if e != nil {
			return e
		}
		owner = p.user.ID
	}
	if err = s.limit("send:"+value, 1, time.Minute); err != nil {
		return err
	}
	id := randomToken()
	number, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return err
	}
	code := number.String()
	code = strings.Repeat("0", 6-len(code)) + code
	// Uniform delivery regardless of identity existence; no account lookup is exposed.
	if err = s.config.Sender.Send(r.Context(), value, code); err != nil {
		return &apiError{503, "delivery_failed", "验证码暂时无法发送，请稍后重试"}
	}
	_, err = s.db.ExecContext(r.Context(), `INSERT INTO verification_challenges(id,purpose,identifier,code_hash,user_id,expires_at) VALUES(?,?,?,?,?,?)`, id, in.Purpose, value, s.codeHash(id, code), owner, time.Now().Add(10*time.Minute).Unix())
	if err != nil {
		return err
	}
	return send(w, 200, map[string]string{"challengeId": id, "message": "请查收验证码（10 分钟内有效）"})
}

// Invalid attempts are committed even when the enclosing account action fails.
func (s *Server) consume(ctx context.Context, tx *sql.Tx, id, code, purpose, value, owner string) error {
	if len(id) > 128 || len(code) != 6 {
		return bad("验证码无效或已过期")
	}
	var hash string
	var attempts int
	err := tx.QueryRowContext(ctx, `UPDATE verification_challenges SET attempts=attempts+1 WHERE id=? AND purpose=? AND identifier=? AND user_id=? AND expires_at>? AND consumed_at IS NULL AND attempts<5 RETURNING code_hash,attempts`, id, purpose, value, owner, time.Now().Unix()).Scan(&hash, &attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return bad("验证码无效或已过期")
	}
	if err != nil {
		return err
	}
	if !hmac.Equal([]byte(hash), []byte(s.codeHash(id, code))) {
		if err = tx.Commit(); err != nil {
			return err
		}
		return bad("验证码无效或已过期")
	}
	_, err = tx.ExecContext(ctx, `UPDATE verification_challenges SET consumed_at=? WHERE id=?`, time.Now().Unix(), id)
	return err
}
func (s *Server) register(w http.ResponseWriter, r *http.Request) error {
	if err := s.rate(r, "register", 10); err != nil {
		return err
	}
	var in struct{ Identifier, Password, ChallengeID, Code string }
	if err := decode(w, r, &in); err != nil {
		return err
	}
	kind, value, err := normalize(in.Identifier)
	if err != nil {
		return bad(err.Error())
	}
	if kind != "email" || s.config.Sender == nil {
		return &apiError{503, "delivery_unavailable", "暂不支持该方式注册"}
	}
	if !validPassword(in.Password) {
		return bad("密码至少 6 个字符，最多 256 字节")
	}
	hash := hashPassword(in.Password)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = s.consume(r.Context(), tx, in.ChallengeID, in.Code, "register", value, ""); err != nil {
		return err
	}
	var count int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM user_identities WHERE normalized_value=?`, value).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return bad("无法注册，请尝试登录或找回密码")
	}
	id := randomToken()
	if _, err = tx.Exec(`INSERT INTO users(id,password_hash,created_at) VALUES(?,?,?)`, id, hash, time.Now().Unix()); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO user_identities(user_id,kind,normalized_value,verified_at) VALUES(?,?,?,?)`, id, kind, value, time.Now().Unix()); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return send(w, 201, map[string]bool{"ok": true})
}
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) error {
	if err := s.rate(r, "change", 10); err != nil {
		return err
	}
	p, err := s.principal(r)
	if err != nil {
		return err
	}
	var in struct{ OldPassword, Password string }
	if err = decode(w, r, &in); err != nil {
		return err
	}
	if !validPassword(in.Password) {
		return bad("密码至少 6 个字符，最多 256 字节")
	}
	if !validPassword(in.OldPassword) || !checkPassword(p.hash, in.OldPassword) {
		return bad("原密码不正确")
	}
	hash := hashPassword(in.Password)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE users SET password_hash=?,must_change_password=0 WHERE id=? AND password_hash=? AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?)`, hash, p.user.ID, p.hash, p.token, time.Now().Unix())
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return unauthorized()
	}
	if _, err = tx.Exec(`DELETE FROM sessions WHERE user_id=?`, p.user.ID); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return send(w, 200, map[string]bool{"ok": true})
}
func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request) error {
	if err := s.rate(r, "reset", 10); err != nil {
		return err
	}
	var in struct{ Identifier, Password, ChallengeID, Code string }
	if err := decode(w, r, &in); err != nil {
		return err
	}
	kind, value, err := normalize(in.Identifier)
	if err != nil {
		return bad(err.Error())
	}
	if kind != "email" || s.config.Sender == nil {
		return &apiError{503, "delivery_unavailable", "该找回通道暂不可用"}
	}
	if !validPassword(in.Password) {
		return bad("密码至少 6 个字符，最多 256 字节")
	}
	hash := hashPassword(in.Password)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = s.consume(r.Context(), tx, in.ChallengeID, in.Code, "reset", value, ""); err != nil {
		return err
	}
	if _, err = tx.Exec(`DELETE FROM sessions WHERE user_id=(SELECT user_id FROM user_identities WHERE normalized_value=?)`, value); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE users SET password_hash=?,must_change_password=0 WHERE id=(SELECT user_id FROM user_identities WHERE normalized_value=?)`, hash, value); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return send(w, 200, map[string]bool{"ok": true})
}
func (s *Server) bind(w http.ResponseWriter, r *http.Request) error {
	if err := s.rate(r, "bind", 10); err != nil {
		return err
	}
	p, err := s.principal(r)
	if err != nil {
		return err
	}
	if p.user.MustChangePassword {
		return bad("请先修改初始密码")
	}
	var in struct{ Identifier, ChallengeID, Code string }
	if err = decode(w, r, &in); err != nil {
		return err
	}
	kind, value, err := normalize(in.Identifier)
	if err != nil {
		return bad(err.Error())
	}
	if kind != "email" || s.config.Sender == nil {
		return &apiError{503, "delivery_unavailable", "该绑定通道暂不可用"}
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var valid int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM sessions WHERE token_hash=? AND expires_at>?`, p.token, time.Now().Unix()).Scan(&valid); err != nil {
		return err
	}
	if valid != 1 {
		return unauthorized()
	}
	if err = s.consume(r.Context(), tx, in.ChallengeID, in.Code, "bind", value, p.user.ID); err != nil {
		return err
	}
	var count int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM user_identities WHERE normalized_value=? OR (user_id=? AND kind=?)`, value, p.user.ID, kind).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return bad("无法绑定该标识，可能已绑定同类标识或已被使用")
	}
	if _, err = tx.Exec(`INSERT INTO user_identities(user_id,kind,normalized_value,verified_at) VALUES(?,?,?,?)`, p.user.ID, kind, value, time.Now().Unix()); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return send(w, 200, map[string]bool{"ok": true})
}
func (s *Server) Cleanup(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at<?`, time.Now().Unix())
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM verification_challenges WHERE expires_at<?`, time.Now().Add(-24*time.Hour).Unix())
	return err
}

type responseRecorder struct {
	http.ResponseWriter
	status int
}

func (w *responseRecorder) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
