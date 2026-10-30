"""Build web/assets/data/pep-chinese-grade8a-midterm-firstletter.json from recitation_data-v2.json.

Usage: python3 -I build_firstletter_data.py ~/Downloads/recitation_data-v2.json
"""
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "web/assets/data/pep-chinese-grade8a-midterm-firstletter.json"
# Source data fixes: (title, clause, correct letters)
FIXES = [("生于忧患，死于安乐", "傅说举于版筑之间", "f y j y b z z j")]


def han(text):
    return [c for c in text if "一" <= c <= "鿿"]


def letters(text):
    return re.findall(r"[a-z]", text)


def paragraphs(item, poem):
    """Textbook paragraphs as content end offsets. Shi poems stay whole; ci keep 上片/下片."""
    paras = item.get("paragraphs") or []
    if (poem and "古词" not in item["type"]) or len(paras) < 2:
        return []
    if "".join(p["content"] for p in paras) != item["content"]:
        print(f"{item['title']}: paragraphs do not cover the content, kept whole", file=sys.stderr)
        return []
    out, end = [], 0
    for p in paras:
        end += len(p["content"])
        m = re.match(r"(.+?)（(.+)）$", p["section_name"])
        label, summary = (m.group(1), m.group(2)) if m else (p["section_name"], "")
        out.append({"label": label, "summary": summary, "end": end})
    return out


def main(src):
    data = json.loads(Path(src).read_text(encoding="utf-8"))
    pieces = []
    for index, item in enumerate(data, 1):
        content, initials = item["content"], item["pinyin_first_letters"]
        for title, clause, fixed in FIXES:
            if item["title"] != title:
                continue
            # Rebuild initials clause by clause so the fix lands in the right place.
            clauses = [c for c in re.split(r"[，。；：？！、“”]+", content) if han(c)]
            groups = [g for g in re.split(r"[,.;:?!\"]+", initials) if letters(g)]
            groups = [fixed if c == clause else g for c, g in zip(clauses, groups)]
            initials = " ".join(groups)
        chars, marks = han(content), letters(initials)
        if len(chars) != len(marks):
            sys.exit(f"{item['title']}: {len(chars)} chars but {len(marks)} letters")
        keys = []
        for key in item["key_sentences"]:
            if key["sentence"] not in content:
                sys.exit(f"{item['title']}: key sentence not in content: {key['sentence']}")
            keys.append({"prompt": key["prompt"], "sentence": key["sentence"]})
        poem = "古诗" in item["type"] or "古词" in item["type"]
        pieces.append({
            "id": f"p{index}",
            "unit": item["unit"],
            "lesson": item["lesson"],
            "title": item["title"],
            "author": item["author"],
            "type": item["type"],
            "poem": poem,
            "content": content,
            "paragraphs": paragraphs(item, poem),
            "letters": "".join(marks),
            "keys": keys,
        })
    OUT.write_text(json.dumps({"version": 1, "pieces": pieces}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(pieces)} pieces, {sum(len(p['letters']) for p in pieces)} chars, "
          f"{sum(len(p['keys']) for p in pieces)} key sentences -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
