"""Build the grade 4 Chinese word cards from the word list.

Writes web/textbooks/pep/chinese/grade4a-characters.html (from the grade 7 page as template)
and the review-api deck file server/internal/api/content/grade4a-characters.json.

Usage: python3 -I build_grade4a_characters.py sources/pep-chinese-grade4a-words.json
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "web/textbooks/pep/chinese/grade7b-characters.html"
PAGE = ROOT / "web/textbooks/pep/chinese/grade4a-characters.html"
DECK = ROOT / "server/internal/api/content/grade4a-characters.json"
DECK_KEY = "textbooks/pep/chinese/grade4a-characters"
# 释义样式和 iPad 适配：放大卡片和按钮，连点卡片不触发双击缩放，触屏不显示键盘快捷键说明。
IPAD_CSS = """  .exp{max-width:86%;margin:14px auto 0;color:#6f665b;font-size:16px;line-height:1.6;text-align:center}
  button,select,.card{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
  /* 释义→词语：正面显示释义（词本身遮成～），格子提示字数，可点开首字母提示 */
  .clue{display:flex;flex-direction:column;align-items:center;gap:16px;padding:0 26px;text-align:center}
  .clue-text{font-size:clamp(20px,5.6vw,28px);line-height:1.6;color:var(--ink)}
  .slots{display:flex;gap:6px}
  .slots i{width:30px;height:30px;border:1.5px dashed var(--seal-soft);border-radius:4px;display:flex;align-items:center;justify-content:center;
    font-style:normal;font-size:16px;font-weight:600;color:var(--seal);font-family:"Helvetica Neue",Arial,sans-serif}
  .hint-btn{font-size:13px;color:var(--ink-soft);background:none;border:1px solid var(--line);border-radius:99px;padding:5px 14px;cursor:pointer}
  .back-py{color:var(--seal);font-size:clamp(18px,5vw,26px);font-weight:600;margin-top:10px;text-align:center;
    font-family:"Helvetica Neue","Segoe UI",Arial,sans-serif}
  @media(min-width:768px){
    .wrap{max-width:860px}
    .clue-text{font-size:32px}.slots i{width:40px;height:40px;font-size:20px}.back-py{font-size:32px}
    .card{max-height:58vh}
    .pinyin{font-size:56px}
    .word.len1{font-size:150px}.word.len2{font-size:120px}.word.len3{font-size:96px}.word.len4{font-size:84px}.word.lenL{font-size:60px}
    .exp{font-size:20px}
    select,.btn{min-height:44px;font-size:15px}
    .icon-btn{width:48px;height:44px}
    .reset{min-height:40px;font-size:14px}
    .nav .btn{width:64px;font-size:22px}
    .mark .btn{font-size:17px}
  }
  @media(hover:none){footer{display:none}}
"""
# dir: 0 拼音→词语, 1 词语→拼音, 2 释义→词语（看释义说出词语）。
RENDER_JS = r"""  if(pref.dir===2){
    // 释义里出现词本身时遮掉，免得直接看到答案
    const clue=(w.exp||"").split(w.word).join("～".repeat(w.word.length));
    const initials=w.py.split(/\s+/).map(s=>s.normalize("NFD")[0]);
    f.innerHTML=`<div class="clue"><div class="clue-text">${clue}</div>`+
      `<div class="slots">${[...w.word].map(()=>"<i></i>").join("")}</div>`+
      `<button class="hint-btn" type="button">提示首字母</button></div>`;
    f.querySelector(".hint-btn").onclick=e=>{e.stopPropagation();
      f.querySelectorAll(".slots i").forEach((el,i)=>el.textContent=initials[i]||"");e.currentTarget.remove()};
    b.innerHTML=wordHTML+`<div class="back-py">${w.py}</div>`+(w.exp?`<div class="exp">${w.exp}</div>`:"");
  }else{
    f.innerHTML=pref.dir===0 ? pinyinHTML : wordHTML;
    b.innerHTML=(pref.dir===0 ? wordHTML : pinyinHTML)+(w.exp?`<div class="exp">${w.exp}</div>`:"");
  }"""
DIR_JS = """const DIR_NAMES=["拼音→词语","词语→拼音","释义→词语"];
function refreshDir(){if(!(pref.dir in DIR_NAMES))pref.dir=0;dirBtn.textContent=DIR_NAMES[pref.dir];dirBtn.classList.toggle("on",pref.dir!==0);}
dirBtn.onclick=()=>{pref.dir=(pref.dir+1)%DIR_NAMES.length;save(LS_PREF,pref);refreshDir();render()};"""


def group(words):
    units = []
    for w in words:
        if not units or units[-1]["unit"] != w["unit"]:
            units.append({"unit": w["unit"], "lessons": []})
        lessons = units[-1]["lessons"]
        if not lessons or lessons[-1]["lesson"] != w["lesson"]:
            lessons.append({"lesson": w["lesson"], "words": []})
        lessons[-1]["words"].append([w["word"], w["pinyin"], w["explanation"]])
    return units


def replace(text, old, new, count=1):
    if text.count(old) != count:
        sys.exit(f"template changed, cannot find: {old[:60]!r}")
    return text.replace(old, new)


def main(src):
    units = group(json.loads(Path(src).read_text(encoding="utf-8")))
    page = TEMPLATE.read_text(encoding="utf-8")
    data = "const DATA = " + json.dumps(
        [{"unit": u["unit"], "lessons": u["lessons"]} for u in units], ensure_ascii=False, indent=1) + ";"
    page = re.sub(r"const DATA = \[.*?\n\];", lambda _: data, page, count=1, flags=re.S)
    page = replace(page, "<title>七年级语文 · 生字词卡片</title>", "<title>四年级语文 · 字词卡片</title>")
    page = replace(page, "<h1>七年级语文 · 生字词卡片</h1>", "<h1>四年级上册语文 · 字词卡片</h1>")
    page = replace(page, 'const LS_MASTER="zwk_master_v1", LS_PREF="zwk_pref_v1", LS_STATUS="zwk_status_v2";',
                   'const LS_MASTER="zwk4a_master_v1", LS_PREF="zwk4a_pref_v1", LS_STATUS="zwk4a_status_v1";')
    # 每个词带释义，显示在答案面。
    page = replace(page, "ls.words.forEach(([word,py])=>{\n    out.push({word,py,",
                   "ls.words.forEach(([word,py,exp])=>{\n    out.push({word,py,exp,")
    page = replace(page, "  f.innerHTML=pref.dir===0 ? pinyinHTML : wordHTML;\n"
                         "  b.innerHTML=pref.dir===0 ? wordHTML : pinyinHTML;", RENDER_JS)
    page = replace(page, '<button class="btn" id="dirBtn" title="切换拼音/汉字方向">拼音→汉字</button>',
                   '<button class="btn" id="dirBtn" title="切换练习方式">拼音→词语</button>')
    page = replace(page, 'function refreshDir(){dirBtn.textContent=pref.dir===0?"拼音→汉字":"汉字→拼音";'
                         'dirBtn.classList.toggle("on",pref.dir===1);}\n'
                         'dirBtn.onclick=()=>{pref.dir=pref.dir?0:1;save(LS_PREF,pref);refreshDir();render()};', DIR_JS)
    # 课名是《观潮》这种格式，没有“第N课”。
    page = replace(page, '  return DATA[ui].unit+" · "+DATA[ui].lessons[li].lesson.match(/第\\d+课/)[0];',
                   '  return DATA[ui].unit+" · "+DATA[ui].lessons[li].lesson;')
    page = replace(page, '  const tag=`${w.unit.replace("第","").replace("单元","单元")} · ${w.lesson.match(/第\\d+课/)[0]}`;',
                   "  const tag=`${w.unit} · ${w.lesson}`;")
    page = replace(page, "</style>", IPAD_CSS + "</style>")
    page = replace(page, 'deckKey:"textbooks/pep/chinese/grade7b-characters",', f'deckKey:"{DECK_KEY}",')
    page = replace(page, '"zwk"', '"zwk4a"', count=3)  # 同步、导出、导入里的 app 标识
    page = replace(page, 'title:"人教语文七下生字词",', 'title:"人教语文四上字词",')
    PAGE.write_text(page, encoding="utf-8")

    deck = {"deckKey": DECK_KEY, "kind": "flashcards", "title": "四上语文字词", "subject": "chinese", "app": "zwk4a",
            "source": "web/textbooks/pep/chinese/grade4a-characters.html",
            "units": [{"unit": u["unit"], "lessons": [{"lesson": l["lesson"], "words": [w[:2] for w in l["words"]]}
                                                      for l in u["lessons"]]} for u in units]}
    DECK.write_text(json.dumps(deck, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n = sum(len(l["words"]) for u in units for l in u["lessons"])
    print(f"{n} words in {len(units)} units -> {PAGE.name}, {DECK.name}")


if __name__ == "__main__":
    main(sys.argv[1])
