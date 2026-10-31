"""Build web/assets/data/pep-chinese-grade8a-midterm-firstletter.json from recitation_data-v4.json.

Usage: python3 -I build_firstletter_data.py ~/Downloads/recitation_data-v4.json
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

OUT = Path(__file__).resolve().parent / "web/assets/data/pep-chinese-grade8a-midterm-firstletter.json"
# Source pinyin fixes: (title, char) -> textbook reading
PINYIN_FIXES = {("钱塘湖春行", "贾"): "jiǎ", ("赤壁", "铁"): "tiě"}


def han(text):
    return [c for c in text if "一" <= c <= "鿿"]


def initial(syllable):
    """First letter without tone marks: "ài" -> "a", "lüè" -> "l"."""
    return unicodedata.normalize("NFD", syllable)[0].lower()


def char_pinyin(item):
    """One pinyin syllable per Han character of the content."""
    pairs = item["char_pinyin"]
    if "".join(p["char"] for p in pairs) != item["content"]:
        sys.exit(f"{item['title']}: char_pinyin does not match the content")
    out = []
    for p in pairs:
        if p["char"] not in han(p["char"]):
            continue
        if not re.fullmatch(r"[a-zàáǎèéěìíǐòóǒùúǔüǖǘǚǜāēīōū]+", p["pinyin"]):
            sys.exit(f"{item['title']}: bad pinyin for {p['char']}: {p['pinyin']}")
        out.append(PINYIN_FIXES.get((item["title"], p["char"]), p["pinyin"]))
    return out


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
        content = item["content"]
        syllables = char_pinyin(item)
        if len(han(content)) != len(syllables):
            sys.exit(f"{item['title']}: {len(han(content))} chars but {len(syllables)} syllables")
        marks = [initial(s) for s in syllables]
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
            "pinyin": " ".join(syllables),
            "keys": keys,
        })
    OUT.write_text(json.dumps({"version": 1, "pieces": pieces}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(pieces)} pieces, {sum(len(p['letters']) for p in pieces)} chars, "
          f"{sum(len(p['keys']) for p in pieces)} key sentences -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
