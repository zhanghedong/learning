"""Build web/assets/data/renai-english-grade8s-midterm-spelling.json.

Sources: the textbook word list (vocabulary_u1_u3.json) and the teacher's review
sheets transcribed in sources/renai-english-grade8s-teacher-review.json.

Usage: python3 -I build_spelling_data.py ~/Downloads/vocabulary_u1_u3.json

Textbook mode (units with vocabulary and sentences, e.g. grade 4):
  python3 -I build_spelling_data.py sources/english-grade4a.json web/assets/data/english-grade4a-spelling.json
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "web/assets/data/renai-english-grade8s-midterm-spelling.json"
TEACHER = ROOT / "sources/renai-english-grade8s-teacher-review.json"
QUIZ_UNIT = "U3 小测"
# Two phrases in one quiz entry: item -> [(display, meaning)]
SPLITS = {
    "succeed in doing / lead to success": [("succeed in doing", "成功做某事"), ("lead to success", "通往成功")],
}
# Accepted answers that can't be derived mechanically.
ANSWERS = {
    "buy sb. sth. (buy sth. for sb.)": ["buy sb sth", "buy sth for sb"],
    "IT (=Information Technology)": ["it", "information technology"],
    "a.m.": ["a m", "am"],
    "favorite": ["favorite", "favourite"],
}
# Proper nouns shown with the Chinese prompt in textbook mode: sentence -> names
NAMES = {"Li Li gets up at 7:20 a.m. She has breakfast at 7:40 a.m.": ["Li Li"]}


def norm(text):
    """Same rules as normAnswer() in grade8s-spelling.js."""
    t = text.lower().replace("’", "'").replace("‘", "'").replace("…", " ").replace(".", " ").replace("-", " ")
    t = re.sub(r"\bsomebody\b", "sb", t)
    t = re.sub(r"\bsomething\b", "sth", t)
    return re.sub(r"\s+", " ", t).strip()


# Sentence checking ignores case, punctuation and these spelling variants (same as normSentence() in JS).
CONTRACTIONS = {
    "i'm": "i am", "it's": "it is", "what's": "what is", "that's": "that is", "he's": "he is", "she's": "she is",
    "there's": "there is", "let's": "let us", "you're": "you are", "we're": "we are", "they're": "they are",
    "i'll": "i will", "i've": "i have", "don't": "do not", "doesn't": "does not", "didn't": "did not",
    "won't": "will not", "can't": "can not", "cannot": "can not", "needn't": "need not", "isn't": "is not",
    "aren't": "are not",
}
NUMBERS = {"5": "five", "6": "six", "25": "twenty five"}
SPELLING = {"colour": "color", "colourful": "colorful", "favourite": "favorite", "favourites": "favorites",
            "practised": "practiced"}


def norm_sentence(text):
    t = text.lower().replace("’", "'").replace("‘", "'").replace("a.m.", "am").replace("p.m.", "pm")
    t = re.sub(r"[\"“”]", "", t)
    t = re.sub(r"[-—–…,.!?;:()]", " ", t)
    words = []
    for w in t.split():
        w = CONTRACTIONS.get(w, NUMBERS.get(w, SPELLING.get(w, w)))
        words += w.split()
    return " ".join(words)


def alternatives(text):
    """"stay / keep away from", "sb./sth.": one-word alternatives around a slash."""
    m = re.search(r"(\S+?)\s*/\s*(\S+)", text)
    if not m:
        return [text]
    return [text[:m.start()] + m.group(1) + text[m.end():], text[:m.start()] + m.group(2) + text[m.end():]]


def sentence_answers(text):
    out = [norm_sentence(a) for a in alternatives(text)]
    for a in out:
        if not re.fullmatch(r"[a-z0-9' ]+", a):
            sys.exit(f"cannot derive answers for {text!r}: {a!r}")
    return list(dict.fromkeys(out))


def answers(item):
    if item in ANSWERS:
        return ANSWERS[item]
    forms = [item]
    # "according (to)": the bracketed part is optional.
    m = re.search(r"\s*\(([^)]+)\)", item)
    if m:
        forms = [item[:m.start()] + item[m.end():], item[:m.start()] + " " + m.group(1) + item[m.end():]]
    out = [norm(a) for f in forms for a in alternatives(f)]
    for a in out:
        if not re.fullmatch(r"[a-z' ]+", a):
            sys.exit(f"cannot derive answers for {item!r}: {a!r}")
    return list(dict.fromkeys(out))


def slug(text):
    return re.sub(r"[^a-z]+", "-", norm(text).replace("'", "")).strip("-")


def unique(base, used):
    uid, n = base, 2
    while uid in used:
        uid, n = f"{base}-{n}", n + 1
    used.add(uid)
    return uid


def build_textbook(data, out):
    """Units with vocabulary (words/phrases) and sentences, no teacher material."""
    items, used = [], set()
    for unit in data["units"]:
        n = re.sub(r"\D", "", unit["unit"])
        group = f"{unit['unit']} · {unit['title']}"
        for v in unit["vocabulary"]:
            display = v["item"].strip()
            acc = answers(display)
            items.append({"id": unique(f"u{n}-{slug(display)}", used), "unit": unit["unit"], "unitTitle": unit["title"],
                          "groups": [group], "text": display, "answers": acc, "meaning": v["meaning"].strip(),
                          "phonetic": v.get("phonetic", ""), "kind": "phrase" if " " in acc[0] else "word"})
        for row in unit.get("sentences", []):
            acc = sentence_answers(row["sentence"])
            rec = {"id": unique(f"s{n}-" + "-".join(acc[0].replace("'", "").split()[:6]), used), "unit": unit["unit"],
                   "unitTitle": unit["title"], "groups": [f"{unit['unit']} · 句子"], "text": row["sentence"],
                   "answers": acc, "meaning": row["meaning"], "phonetic": "", "kind": "sentence"}
            if row["sentence"] in NAMES:
                rec["names"] = NAMES[row["sentence"]]
            items.append(rec)
    Path(out).write_text(json.dumps({"version": 1, "items": items}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    counts = {}
    for it in items:
        counts[it["kind"]] = counts.get(it["kind"], 0) + 1
    print(f"{len(items)} items {counts} -> {out}")


def main(src, out=OUT):
    data = json.loads(Path(src).read_text(encoding="utf-8"))
    if "notebook_title" not in data:
        return build_textbook(data, out)
    items, by_answer, used = [], {}, set()

    def add(unit, title, display, meaning, phonetic, kind, source=""):
        acc = answers(display)
        key = acc[0]
        if unit == QUIZ_UNIT and key in by_answer:
            # Quiz items that are already in a unit list only get tagged as 小测考点.
            hit = by_answer[key]
            hit["quiz"] = True
            hit["source"] = source
            return
        base = ("q-" if unit == QUIZ_UNIT else "u" + unit[-1] + "-") + slug(display)
        uid, n = base, 2
        while uid in used:
            uid, n = f"{base}-{n}", n + 1
        used.add(uid)
        rec = {"id": uid, "unit": unit, "unitTitle": title, "groups": [unit + " · " + title], "text": display,
               "answers": acc, "meaning": meaning, "phonetic": phonetic, "kind": kind}
        if source:
            rec["quiz"], rec["source"] = True, source
        items.append(rec)
        by_answer.setdefault(key, rec)

    for unit in data["units"]:
        quiz = unit["unit"].startswith("Unit 3 两次小测")
        name, title = (QUIZ_UNIT, "两次小测考点") if quiz else (unit["unit"], unit["title"])
        for v in unit["vocabulary"]:
            kind = "phrase" if "phrase" in v["type"] or " " in v["item"].strip() else "word"
            if v["item"] in SPLITS:
                for display, meaning in SPLITS[v["item"]]:
                    add(name, title, display, meaning, "", "phrase", v.get("source", ""))
                continue
            add(name, title, v["item"].strip(), v["meaning"].strip(), v.get("phonetic", ""), kind, v.get("source", ""))

    # 老师复习材料：已在词表里的短语只打上标记，其余短语和全部句子新增。
    teacher = json.loads(TEACHER.read_text(encoding="utf-8"))
    for unit in teacher["units"]:
        n = unit["unit"][-1]
        for sec in unit["sections"]:
            label = f"{unit['unit']} {sec['name']}"
            for meaning, display in sec["phrases"]:
                acc = answers(display)
                hit = next((by_answer[a] for a in acc if a in by_answer), None)
                if hit:
                    if "老师短语 · " + label not in hit["groups"]:
                        hit["groups"].append("老师短语 · " + label)
                    hit["teacher"] = True
                    continue
                uid, k = f"t{n}-{slug(display)}", 2
                while uid in used:
                    uid, k = f"t{n}-{slug(display)}-{k}", k + 1
                used.add(uid)
                rec = {"id": uid, "unit": unit["unit"], "unitTitle": "老师复习", "groups": ["老师短语 · " + label],
                       "text": display, "answers": acc, "meaning": meaning, "phonetic": "", "kind": "phrase", "teacher": True}
                items.append(rec)
                for a in acc:
                    by_answer.setdefault(a, rec)
            for row in sec["sentences"]:
                meaning, display = row[0], row[1]
                acc = sentence_answers(display)
                base = f"s{n}-" + "-".join(acc[0].replace("'", "").split()[:6])
                uid, k = base, 2
                while uid in used:
                    uid, k = f"{base}-{k}", k + 1
                used.add(uid)
                rec = {"id": uid, "unit": unit["unit"], "unitTitle": "老师复习", "groups": ["老师句子 · " + label],
                       "text": display, "answers": acc, "meaning": meaning, "phonetic": "", "kind": "sentence", "teacher": True}
                if len(row) > 2:
                    rec["names"] = row[2]
                items.append(rec)

    OUT.write_text(json.dumps({"version": 1, "title": data["notebook_title"], "items": items},
                              ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    counts = {}
    for it in items:
        counts[it["kind"]] = counts.get(it["kind"], 0) + 1
    print(f"{len(items)} items {counts}, {sum(1 for i in items if i.get('quiz'))} quiz-tagged, "
          f"{sum(1 for i in items if i.get('teacher'))} teacher -> {OUT}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
