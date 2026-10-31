package api

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

func randomToken() string       { return rand.Text() }
func tokenHash(s string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(s))) }

// 家庭内部使用，允许 6 位数字密码。
func validPassword(s string) bool { return utf8.RuneCountInString(s) >= 6 && len(s) <= 256 }
func hashPassword(s string) string {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		panic(err)
	}
	key := argon2.IDKey([]byte(s), salt, 2, 64*1024, 2, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=2,p=2$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
}
func checkPassword(hash, s string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" || parts[3] != "m=65536,t=2,p=2" {
		return false
	}
	salt, e := base64.RawStdEncoding.DecodeString(parts[4])
	if e != nil || len(salt) != 16 {
		return false
	}
	expected, e := base64.RawStdEncoding.DecodeString(parts[5])
	if e != nil || len(expected) != 32 {
		return false
	}
	actual := argon2.IDKey([]byte(s), salt, 2, 64*1024, 2, 32)
	return subtle.ConstantTimeCompare(expected, actual) == 1
}
