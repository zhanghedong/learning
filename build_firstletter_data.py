"""Build first-letter recitation data.

Grade 8 (source has char_pinyin):
  python3 -I build_firstletter_data.py ~/Downloads/recitation_data-v4.json
Grade 4 (no char_pinyin; generated with pypinyin, the source's first letters pick polyphone readings):
  <python with pypinyin> -I build_firstletter_data.py ~/Downloads/recitation.json \
      web/assets/data/pep-chinese-grade4a-firstletter.json
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

OUT = Path(__file__).resolve().parent / "web/assets/data/pep-chinese-grade8a-midterm-firstletter.json"
# Source pinyin fixes: (title, char) -> textbook reading
PINYIN_FIXES = {
    ("钱塘湖春行", "贾"): "jiǎ", ("赤壁", "铁"): "tiě",
    # 四年级：pypinyin 的多音字读音按课本改
    ("观潮（第3-4自然段）", "一"): "yī", ("观潮（第3-4自然段）", "得"): "de",
    ("赠刘景文", "尽"): "jìn", ("黄鹤楼送孟浩然之广陵", "尽"): "jìn",
    ("暮江吟", "似"): "sì", ("暮江吟", "铺"): "pū",
    ("日积月累·气象谚语", "场"): "cháng",
    ("精卫填海", "为"): "wéi", ("夏日绝句", "为"): "wéi", ("夏日绝句", "当"): "dāng",
    ("王戎不取道旁李", "子"): "zǐ",
    ("出塞", "还"): "huán", ("出塞", "将"): "jiàng",
}


def han(text):
    return [c for c in text if "一" <= c <= "鿿"]


def initial(syllable):
    """First letter without tone marks: "ài" -> "a", "lüè" -> "l"."""
    return unicodedata.normalize("NFD", syllable)[0].lower()


def generated_pinyin(item, content):
    """pypinyin per character; where the source's first letters disagree, take the reading that matches."""
    from pypinyin import Style, lazy_pinyin, pinyin
    chars = han(content)
    out = [s for c, s in zip(content, lazy_pinyin(content, style=Style.TONE, errors=lambda t: list(t))) if "一" <= c <= "鿿"]
    expect = re.findall(r"[a-z]", item.get("pinyin_first_letters", ""))
    if len(expect) != len(out):
        print(f"{item['title']}: source has {len(expect)} letters for {len(out)} chars, using generated pinyin", file=sys.stderr)
        return out
    for i, (c, s, e) in enumerate(zip(chars, out, expect)):
        if initial(s) == e:
            continue
        hit = next((h for h in pinyin(c, style=Style.TONE, heteronym=True)[0] if initial(h) == e), None)
        if hit:
            out[i] = hit
        print(f"{item['title']}: {c} {s} vs letter {e} -> {out[i]}", file=sys.stderr)
    return out


def char_pinyin(item, content):
    """One pinyin syllable per Han character of the content."""
    if "char_pinyin" not in item:
        out = generated_pinyin(item, content)
        return [PINYIN_FIXES.get((item["title"], c), s) for c, s in zip(han(content), out)]
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


def main(src, out=OUT):
    data = json.loads(Path(src).read_text(encoding="utf-8"))
    pieces = []
    for index, item in enumerate(data, 1):
        content = item["content"]
        paras_text = "".join(p["content"] for p in item.get("paragraphs") or [])
        if "char_pinyin" not in item and paras_text and paras_text != content:
            # 名言等：正文带“——出处”，按段落文本背。
            content = paras_text
        syllables = char_pinyin(item, content)
        if len(han(content)) != len(syllables):
            sys.exit(f"{item['title']}: {len(han(content))} chars but {len(syllables)} syllables")
        marks = [initial(s) for s in syllables]
        keys = []
        for key in item["key_sentences"]:
            sentence = key["sentence"]
            if sentence not in content:
                # 句末标点可能与正文不同（正文里是逗号、分号）。
                sentence = sentence.rstrip("。；，！？")
            if sentence not in content:
                sys.exit(f"{item['title']}: key sentence not in content: {key['sentence']}")
            keys.append({"prompt": key["prompt"], "sentence": sentence})
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
    Path(out).write_text(json.dumps({"version": 1, "pieces": pieces}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(pieces)} pieces, {sum(len(p['letters']) for p in pieces)} chars, "
          f"{sum(len(p['keys']) for p in pieces)} key sentences -> {out}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
