package api

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"strconv"
)

//go:embed content/*.json
var contentFiles embed.FS

type contentDeck struct {
	DeckKey string `json:"deckKey"`
	Kind    string `json:"kind"`
	Subject string `json:"subject"`
	Units   []struct {
		Lessons []struct {
			Lesson string
			Words  [][]string
		}
	} `json:"units"`
	Phases []struct {
		Days []struct{ Tasks []struct{ ID string } }
	} `json:"phases"`
	Pieces []struct {
		ID     string
		Chunks []struct{ ID string }
		Vocabs []struct{ ID string }
	} `json:"pieces"`
}

var contentDecks = loadContent()

func loadContent() map[string]contentDeck {
	entries, err := contentFiles.ReadDir("content")
	if err != nil {
		panic(err)
	}
	decks := map[string]contentDeck{}
	for _, entry := range entries {
		raw, err := contentFiles.ReadFile("content/" + entry.Name())
		if err != nil {
			panic(err)
		}
		var deck contentDeck
		if err = json.Unmarshal(raw, &deck); err != nil {
			panic(err)
		}
		if deck.DeckKey == "" {
			panic("missing deck key")
		}
		decks[deck.DeckKey] = deck
	}
	return decks
}
func validateDeckProgress(key string, raw json.RawMessage) (json.RawMessage, error) {
	deck, ok := contentDecks[key]
	if !ok {
		return nil, bad("教材未开放同步")
	}
	if deck.Kind == "plan" {
		return validatePlan(deck, raw)
	}
	if deck.Kind == "recitations" {
		return validateRecitations(deck, raw)
	}
	if deck.Kind == "opaque" {
		return validateOpaque(raw)
	}
	var state progressState
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil || state.Status == nil || state.Pref == nil {
		return nil, bad("进度结构不正确")
	}
	keys := map[string]bool{}
	for ui, u := range deck.Units {
		for _, l := range u.Lessons {
			for _, word := range l.Words {
				k := strconv.Itoa(ui) + "|" + l.Lesson + "|" + word[0]
				if deck.Subject == "chinese" {
					k = l.Lesson + "|" + word[0]
				}
				keys[k] = true
			}
		}
	}
	for key, value := range state.Status {
		if !keys[key] || (value != "got" && value != "review") {
			return nil, bad("进度包含未知条目或无效状态")
		}
	}
	p := state.Pref
	if p.Unit < -1 || p.Unit >= len(deck.Units) || p.Lesson < -1 || p.Dir < 0 || p.Dir > 1 || p.LastIdx < 0 || p.LastIdx >= len(keys) {
		return nil, bad("学习偏好不正确")
	}
	if (p.Unit == -1 && p.Lesson != -1) || (p.Unit >= 0 && p.Lesson >= len(deck.Units[p.Unit].Lessons)) {
		return nil, bad("课组范围不正确")
	}
	if p.LastKey != "" && !keys[p.LastKey] {
		return nil, bad("上次位置不正确")
	}
	return json.Marshal(state)
}

type recitationRecord struct {
	Stage            int    `json:"stage"`
	Correct          int64  `json:"correct"`
	Wrong            int64  `json:"wrong"`
	LastCorrectRound int64  `json:"lastCorrectRound"`
	LastSelf         string `json:"lastSelf"`
}
type recitationPiece struct {
	Started bool `json:"started"`
	Learned bool `json:"learned"`
	Step    int  `json:"step"`
}
type recitationProgress struct {
	Version int                         `json:"version"`
	Items   map[string]recitationRecord `json:"items"`
	Pieces  map[string]recitationPiece  `json:"pieces"`
	Pref    *struct {
		View    string  `json:"view"`
		PieceID *string `json:"pieceId"`
	} `json:"pref"`
	RoundCounter int64 `json:"roundCounter"`
}

func validateRecitations(deck contentDeck, raw json.RawMessage) (json.RawMessage, error) {
	var state recitationProgress
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil || state.Version != 1 || state.Items == nil || state.Pieces == nil || state.Pref == nil || state.RoundCounter < 0 || state.RoundCounter > 9007199254740991 {
		return nil, bad("古诗文进度结构不正确")
	}
	items := map[string]bool{}
	pieces := map[string]bool{}
	for _, p := range deck.Pieces {
		pieces[p.ID] = true
		for _, v := range p.Vocabs {
			items[v.ID] = true
		}
		for _, c := range p.Chunks {
			items[c.ID] = true
		}
	}
	for id, r := range state.Items {
		if !items[id] || r.Stage < 0 || r.Stage > 3 || r.Correct < 0 || r.Correct > 9007199254740991 || r.Wrong < 0 || r.Wrong > 9007199254740991 || r.LastCorrectRound < 0 || r.LastCorrectRound > state.RoundCounter {
			return nil, bad("古诗文条目或阶段不正确")
		}
		switch r.LastSelf {
		case "", "good", "hint", "bad":
		default:
			return nil, bad("古诗文自评不正确")
		}
	}
	for id, p := range state.Pieces {
		if !pieces[id] || p.Step < 0 || p.Step > 3 {
			return nil, bad("篇目进度不正确")
		}
	}
	switch state.Pref.View {
	case "overview", "learn", "review", "full":
	default:
		return nil, bad("古诗文阅读位置不正确")
	}
	if state.Pref.PieceID != nil && !pieces[*state.Pref.PieceID] {
		return nil, bad("古诗文篇目不存在")
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		return nil, fmt.Errorf("encode recitations: %w", err)
	}
	return encoded, nil
}

// 只有网页在用的模块（首字母默背、期中知识点）由页面自己维护结构，服务端只要求是 JSON 对象。
func validateOpaque(raw json.RawMessage) (json.RawMessage, error) {
	var state map[string]json.RawMessage
	if err := json.Unmarshal(raw, &state); err != nil || state == nil {
		return nil, bad("进度结构不正确")
	}
	var out bytes.Buffer
	if err := json.Compact(&out, raw); err != nil {
		return nil, bad("进度结构不正确")
	}
	return out.Bytes(), nil
}

func validatePlan(deck contentDeck, raw json.RawMessage) (json.RawMessage, error) {
	var state struct {
		Version int                        `json:"version"`
		Checks  map[string]json.RawMessage `json:"checks"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil || state.Version != 1 || state.Checks == nil {
		return nil, bad("计划进度格式不正确")
	}
	ids := map[string]bool{}
	for _, phase := range deck.Phases {
		for _, day := range phase.Days {
			for _, task := range day.Tasks {
				ids[task.ID] = true
			}
		}
	}
	checks := map[string]bool{}
	for id, value := range state.Checks {
		if !ids[id] || (!bytes.Equal(value, []byte("true")) && !bytes.Equal(value, []byte("false"))) {
			return nil, bad("计划包含未知任务或无效勾选")
		}
		if bytes.Equal(value, []byte("true")) {
			checks[id] = true
		}
	}
	return json.Marshal(struct {
		Version int             `json:"version"`
		Checks  map[string]bool `json:"checks"`
	}{1, checks})
}
