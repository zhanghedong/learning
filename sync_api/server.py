#!/usr/bin/env python3
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


DB_PATH = os.environ.get("REVIEW_SYNC_DB", "/data/review-sync/data/review.db")
HOST = os.environ.get("REVIEW_SYNC_HOST", "127.0.0.1")
PORT = int(os.environ.get("REVIEW_SYNC_PORT", "3107"))
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
DECK_RE = re.compile(r"^[a-z0-9][a-z0-9/_-]{0,119}$")
MAX_BODY = 256 * 1024
RATE_BUCKET = {}


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_code(value):
    code = re.sub(r"[^A-Za-z0-9]", "", value or "").upper()
    if len(code) != 8 or any(ch not in CODE_ALPHABET for ch in code):
        return None
    return code


def display_code(code):
    return f"{code[:4]}-{code[4:]}"


def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as conn:
        conn.executescript(
            """
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS sync_profiles (
              code TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_used_at TEXT
            );
            CREATE TABLE IF NOT EXISTS progress_records (
              code TEXT NOT NULL,
              deck_key TEXT NOT NULL,
              data_json TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (code, deck_key),
              FOREIGN KEY (code) REFERENCES sync_profiles(code) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_progress_records_code ON progress_records(code);
            """
        )


def generate_code(conn):
    for _ in range(50):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
        exists = conn.execute("SELECT 1 FROM sync_profiles WHERE code = ?", (code,)).fetchone()
        if not exists:
            return code
    raise RuntimeError("failed to generate unique sync code")


def allow_request(client, action, limit, window=60):
    now = time.time()
    key = (client, action)
    bucket = [t for t in RATE_BUCKET.get(key, []) if now - t < window]
    if len(bucket) >= limit:
        RATE_BUCKET[key] = bucket
        return False
    bucket.append(now)
    RATE_BUCKET[key] = bucket
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = "review-sync/1.0"

    def log_message(self, fmt, *args):
        print("%s - - [%s] %s" % (self.client_address[0], self.log_date_time_string(), fmt % args))

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("请求数据过大")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            raise ValueError("JSON 格式不正确")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/sync/create":
            return self.send_json(404, {"error": "not found"})
        if not allow_request(self.client_address[0], "create", 20):
            return self.send_json(429, {"error": "请求太频繁,请稍后再试"})
        try:
            now = utc_now()
            with db() as conn:
                code = generate_code(conn)
                conn.execute(
                    "INSERT INTO sync_profiles(code, created_at, updated_at, last_used_at) VALUES(?,?,?,?)",
                    (code, now, now, now),
                )
            return self.send_json(200, {"code": display_code(code), "raw_code": code})
        except Exception as exc:
            return self.send_json(500, {"error": str(exc)})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/sync/progress":
            return self.send_json(404, {"error": "not found"})
        if not allow_request(self.client_address[0], "read", 240):
            return self.send_json(429, {"error": "请求太频繁,请稍后再试"})
        qs = parse_qs(parsed.query)
        code = normalize_code((qs.get("code") or [""])[0])
        deck_key = (qs.get("deck_key") or [""])[0]
        if not code:
            return self.send_json(400, {"error": "同步码格式不正确"})
        if not DECK_RE.match(deck_key):
            return self.send_json(400, {"error": "卡片标识不正确"})
        with db() as conn:
            profile = conn.execute("SELECT code FROM sync_profiles WHERE code = ?", (code,)).fetchone()
            if not profile:
                return self.send_json(404, {"error": "同步码不存在"})
            now = utc_now()
            conn.execute("UPDATE sync_profiles SET last_used_at = ? WHERE code = ?", (now, code))
            row = conn.execute(
                "SELECT data_json, updated_at FROM progress_records WHERE code = ? AND deck_key = ?",
                (code, deck_key),
            ).fetchone()
        data = None
        updated_at = None
        if row:
            updated_at = row["updated_at"]
            try:
                data = json.loads(row["data_json"])
            except Exception:
                data = None
        return self.send_json(
            200,
            {"code": display_code(code), "deck_key": deck_key, "data": data, "updated_at": updated_at},
        )

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/sync/progress":
            return self.send_json(404, {"error": "not found"})
        if not allow_request(self.client_address[0], "write", 240):
            return self.send_json(429, {"error": "请求太频繁,请稍后再试"})
        try:
            payload = self.read_json()
        except ValueError as exc:
            return self.send_json(400, {"error": str(exc)})
        code = normalize_code(payload.get("code", ""))
        deck_key = payload.get("deck_key", "")
        data = payload.get("data")
        if not code:
            return self.send_json(400, {"error": "同步码格式不正确"})
        if not DECK_RE.match(deck_key):
            return self.send_json(400, {"error": "卡片标识不正确"})
        if not isinstance(data, dict):
            return self.send_json(400, {"error": "进度数据不正确"})
        data_json = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        if len(data_json.encode("utf-8")) > MAX_BODY:
            return self.send_json(400, {"error": "进度数据过大"})
        now = utc_now()
        with db() as conn:
            profile = conn.execute("SELECT code FROM sync_profiles WHERE code = ?", (code,)).fetchone()
            if not profile:
                return self.send_json(404, {"error": "同步码不存在"})
            conn.execute(
                """
                INSERT INTO progress_records(code, deck_key, data_json, updated_at)
                VALUES(?,?,?,?)
                ON CONFLICT(code, deck_key) DO UPDATE SET
                  data_json = excluded.data_json,
                  updated_at = excluded.updated_at
                """,
                (code, deck_key, data_json, now),
            )
            conn.execute(
                "UPDATE sync_profiles SET updated_at = ?, last_used_at = ? WHERE code = ?",
                (now, now, code),
            )
        return self.send_json(200, {"ok": True, "code": display_code(code), "updated_at": now})


if __name__ == "__main__":
    init_db()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"review-sync listening on http://{HOST}:{PORT}, db={DB_PATH}")
    httpd.serve_forever()
