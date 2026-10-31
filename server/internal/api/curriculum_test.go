package api

import (
	"encoding/json"
	"net/url"
	"testing"
)

func TestAllCurriculumProgress(t *testing.T) {
	f := setup(t)
	f.register("curriculum@example.com")
	token := f.login("curriculum@example.com", "test-password-123")["token"].(string)
	if len(contentDecks) != 11 {
		t.Fatalf("want 11 decks, got %d", len(contentDecks))
	}
	for key, deck := range contentDecks {
		t.Run(key, func(t *testing.T) {
			var payload any
			if deck.Kind == "opaque" {
				payload = map[string]any{"status": map[string]any{"version": 1, "cards": map[string]any{}}, "pref": map[string]any{"version": 1}}
			} else if deck.Kind == "plan" {
				payload = map[string]any{"version": 1, "checks": map[string]bool{"t-2026-11-07-3": true}}
			} else if deck.Kind == "recitations" {
				payload = map[string]any{"version": 1, "items": map[string]any{"l1-p1-v1": map[string]any{"stage": 2, "correct": 1, "wrong": 0, "lastCorrectRound": 1, "lastSelf": ""}}, "pieces": map[string]any{"l1-p1": map[string]any{"started": true, "learned": true, "step": 3}}, "pref": map[string]any{"view": "full", "pieceId": "l1-p1"}, "roundCounter": 1}
			} else {
				first := deck.Units[0].Lessons[0]
				k := "0|" + first.Lesson + "|" + first.Words[0][0]
				if deck.Subject == "chinese" {
					k = first.Lesson + "|" + first.Words[0][0]
				}
				payload = map[string]any{"status": map[string]string{k: "got"}, "pref": map[string]any{"unit": 0, "lesson": -1, "dir": 0, "peekAll": false, "sound": true}}
			}
			path := "/api/v1/progress?deckKey=" + url.QueryEscape(key)
			out := f.request("PUT", path, token, map[string]any{"baseRevision": 0, "mutationId": "curriculum-" + tokenHash(key)[:20], "schemaVersion": 1, "payload": payload}, 200)
			if out["revision"] != float64(1) {
				t.Fatal(out)
			}
			f.request("GET", path, token, nil, 200)
		})
	}
	summaries := f.request("GET", "/api/v1/progress", token, nil, 200)["decks"].([]any)
	if len(summaries) != 11 {
		t.Fatal(len(summaries))
	}
}
func TestRecitationValidation(t *testing.T) {
	deck := contentDecks["textbooks/pep/chinese/grade8a-required-recitations"]
	valid := func() map[string]any {
		return map[string]any{"version": 1, "items": map[string]any{}, "pieces": map[string]any{}, "pref": map[string]any{"view": "overview", "pieceId": nil}, "roundCounter": 0}
	}
	cases := []func(map[string]any){
		func(v map[string]any) { v["items"] = map[string]any{"unknown": map[string]any{"stage": 1}} },
		func(v map[string]any) { v["items"] = map[string]any{"l1-p1-v1": map[string]any{"stage": 4}} },
		func(v map[string]any) { v["roundCounter"] = -1 },
		func(v map[string]any) { v["pieces"] = map[string]any{"l1-p1": map[string]any{"step": 4}} },
		func(v map[string]any) { v["pref"] = map[string]any{"view": "full", "pieceId": "other"} },
	}
	raw, _ := json.Marshal(valid())
	if _, err := validateRecitations(deck, raw); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range cases {
		v := valid()
		mutate(v)
		raw, _ := json.Marshal(v)
		if _, err := validateRecitations(deck, raw); err == nil {
			t.Fatal("accepted", string(raw))
		}
	}
}

func TestPlanValidation(t *testing.T) {
	deck := contentDecks["other/midterm-plan-2026"]
	cases := []struct {
		raw string
		ok  bool
	}{
		{`{"version":1,"checks":{"t-2026-11-07-3":true,"t-2026-11-07-bedtime-reading-v1":false}}`, true},
		{`{"version":1,"checks":{}}`, true},
		{`{"version":2,"checks":{}}`, false},
		{`{"version":1,"checks":{"unknown":true}}`, false},
		{`{"version":1,"checks":{"t-2026-11-07-3":null}}`, false},
		{`{"version":1,"checks":{"t-2026-11-07-3":1}}`, false},
		{`{"version":1,"checks":null}`, false},
	}
	for _, c := range cases {
		_, err := validatePlan(deck, json.RawMessage(c.raw))
		if (err == nil) != c.ok {
			t.Fatalf("validation %s: %v", c.raw, err)
		}
	}
}
