"""Build web/assets/data/renai-english-grade8s-midterm-spelling.json from vocabulary_u1_u3.json.

Usage: python3 -I build_spelling_data.py ~/Downloads/vocabulary_u1_u3.json
"""
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "web/assets/data/renai-english-grade8s-midterm-spelling.json"
QUIZ_UNIT = "U3 小测"
# Two phrases in one quiz entry: item -> [(display, meaning)]
SPLITS = {
    "succeed in doing / lead to success": [("succeed in doing", "成功做某事"), ("lead to success", "通往成功")],
}
# Accepted answers that can't be derived mechanically.
ANSWERS = {
    "buy sb. sth. (buy sth. for sb.)": ["buy sb sth", "buy sth for sb"],
}


def norm(text):
    """Same rules as normAnswer() in grade8s-spelling.js."""
    t = text.lower().replace("’", "'").replace("‘", "'").replace("…", " ").replace(".", " ")
    t = re.sub(r"\bsomebody\b", "sb", t)
    t = re.sub(r"\bsomething\b", "sth", t)
    return re.sub(r"\s+", " ", t).strip()


def answers(item):
    if item in ANSWERS:
        return ANSWERS[item]
    forms = [item]
    # "according (to)": the bracketed part is optional.
    m = re.search(r"\s*\(([^)]+)\)", item)
    if m:
        forms = [item[:m.start()] + item[m.end():], item[:m.start()] + " " + m.group(1) + item[m.end():]]
    # "stay / keep away from": one-word alternatives around a slash.
    out = []
    for f in forms:
        m = re.search(r"(\S+) / (\S+)", f)
        if m:
            out += [f[:m.start()] + m.group(1) + f[m.end():], f[:m.start()] + m.group(2) + f[m.end():]]
        else:
            out.append(f)
    out = [norm(a) for a in out]
    for a in out:
        if not re.fullmatch(r"[a-z' ]+", a):
            sys.exit(f"cannot derive answers for {item!r}: {a!r}")
    return list(dict.fromkeys(out))


def slug(text):
    return re.sub(r"[^a-z]+", "-", norm(text).replace("'", "")).strip("-")


def main(src):
    data = json.loads(Path(src).read_text(encoding="utf-8"))
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
        rec = {"id": uid, "unit": unit, "unitTitle": title, "text": display, "answers": acc,
               "meaning": meaning, "phonetic": phonetic, "kind": kind}
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

    OUT.write_text(json.dumps({"version": 1, "title": data["notebook_title"], "items": items},
                              ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    counts = {}
    for it in items:
        counts[it["unit"]] = counts.get(it["unit"], 0) + 1
    print(f"{len(items)} items {counts}, {sum(1 for i in items if i.get('quiz'))} quiz-tagged -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
