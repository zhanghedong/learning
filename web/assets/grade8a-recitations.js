(function () {
  "use strict";

  const DATA_URL = "../../../assets/data/pep-chinese-grade8a-required-recitations.json";
  const STORAGE_KEY = "pep_chinese_grade8a_reci_v1";
  const APP_ID = "pep-chinese-grade8a-recitations";
  const STAGE_LABELS = ["未学习", "刚学过", "有印象", "已掌握"];
  const POEM_TITLES = new Set([
    "野望", "黄鹤楼", "使至塞上", "渡荆门送别", "钱塘湖春行",
    "饮酒（其五）", "春望", "雁门太守行", "赤壁", "渔家傲"
  ]);
  const CUSTOM_CHUNK_MARKERS = {
    "三峡": ["不见曦月。", "不以疾也。", "良多趣味。"],
    "与朱元思书": ["天下独绝。", "猛浪若奔。"]
  };

  const GUIDES = {
    "三峡": {
      background: "郦道元是北魏地理学家。《三峡》节选自《水经注·江水》，作者借江水流经三峡的记述，描画峡中四季不同的山水面貌。",
      overview: "先总写山高岭连，再依次写夏水、春冬景色和秋日凄清。文章用很短的篇幅写出三峡雄奇、秀丽又清幽的层次。",
      thread: "山势高峻 → 夏水迅疾 → 春冬清荣峻茂 → 秋景凄清",
      memory: "抓住“山—夏—春冬—秋”的顺序。每一层再记一个声音或动作：遮日、朝发暮到、飞漱、高猿长啸。"
    },
    "答谢中书书": {
      background: "陶弘景是南朝齐梁时期的思想家、文学家。本文是一封写给谢中书的短信，也是一篇凝练的山水小品。",
      overview: "作者从高低、远近、早晚多个角度写山川之美，最后以能欣赏奇景为自豪。",
      thread: "总写山川之美 → 四季常景 → 早晚变化 → 感叹知音难得",
      memory: "正文像镜头移动：高峰和清流、石壁和竹林、晓雾和夕日。按三组对偶句记忆最省力。"
    },
    "记承天寺夜游": {
      background: "元丰六年，苏轼被贬黄州。一个月夜，他到承天寺寻找张怀民，两位处境相近的朋友一同赏月。",
      overview: "文章从起意夜游写到庭中月色，再以“闲人”收束，既有赏月的欣喜，也含被贬后的复杂心境。",
      thread: "月色入户 → 寻友同行 → 庭中月景 → 闲人感慨",
      memory: "记住人物动作链：欲睡、起行、寻张怀民、步于中庭；月景只抓“积水—藻荇—竹柏影”。"
    },
    "与朱元思书": {
      background: "吴均是南朝梁文学家，擅长清峻的山水文字。本文以书信形式描写富春江从富阳到桐庐一带的景色。",
      overview: "文章先总写山水奇异，再分写水的清急和山的高险，最后由景生情，表达对自然的向往。",
      thread: "奇山异水 → 异水清急 → 奇山高险 → 望峰息心",
      memory: "先记总领句“奇山异水，天下独绝”，再按“水—山—感受”展开。山中声音可串成泉、鸟、蝉、猿。"
    },
    "野望": {
      background: "王绩生活在隋末唐初，常隐居田园。这首诗写诗人在东皋傍晚眺望秋野时的所见所感。",
      overview: "秋野景色宁静明丽，牧人与猎马各自归来；诗人却无人相识，只能借怀古排遣孤独。",
      thread: "徙倚迷惘 → 秋野远景 → 归人近景 → 孤独怀古",
      memory: "首尾记情，中间两联记景。中间四句按“树—山—牧人—猎马”排列。"
    },
    "黄鹤楼": {
      background: "崔颢登临黄鹤楼，面对古迹、晴川和芳草，由传说写到眼前，再由眼前景物引出乡愁。",
      overview: "诗歌将仙人传说、空楼白云、江上晴景和暮色乡愁融为一体，空间辽阔，情绪逐层下沉。",
      thread: "仙人已去 → 白云悠悠 → 晴川芳草 → 日暮乡愁",
      memory: "四联各抓一个中心词：黄鹤、白云、晴川、乡关。最后用“日暮—烟波—愁”收束。"
    },
    "使至塞上": {
      background: "王维奉命出使边塞，途中写下此诗。个人漂泊感与边塞雄浑景象在诗中交织。",
      overview: "诗人先交代出使，再用征蓬、归雁自比；进入大漠后，视野陡然开阔，最后写到前线军情。",
      thread: "单车出使 → 征蓬归雁 → 大漠长河 → 萧关候骑",
      memory: "中间名句是画面中心：大漠对应孤烟，长河对应落日，一直一圆，一静一动。"
    },
    "渡荆门送别": {
      background: "青年李白乘舟离开蜀地，经过荆门进入楚地。这是他第一次远游途中写下的诗篇之一。",
      overview: "诗歌先写行程，再写平野、大江、月影和云霞，最后把故乡之水人格化，表达眷恋。",
      thread: "远渡荆门 → 山尽江流 → 月下云生 → 江水送行",
      memory: "空间顺序很清楚：山逐渐消失，江进入荒野，月映水中，云生海市，最后回望故乡水。"
    },
    "钱塘湖春行": {
      background: "白居易任杭州刺史期间十分喜爱西湖。这首诗写一次沿湖而行所见的早春景象。",
      overview: "诗人从孤山寺、贾亭出发，依次看到水面、早莺、新燕、乱花和浅草，最后落到最爱的白沙堤。",
      thread: "湖水初平 → 莺燕争春 → 花草渐盛 → 最爱湖东",
      memory: "抓住早春限定词：初平、几处、谁家、渐欲、才能。它们共同说明春天刚刚到来。"
    },
    "得道多助，失道寡助": {
      background: "《孟子》以对话和论辩阐述儒家政治思想。本章围绕战争胜负，说明施行仁政、赢得民心的重要性。",
      overview: "文章先提出中心论点，再用攻城和守城论证，最后把结论提升到治国层面。",
      thread: "提出论点 → 攻城不胜 → 守城而逃 → 得道者多助",
      memory: "先记三组递进：天时不如地利，地利不如人和；域民、固国、威天下；寡助到亲戚畔之，多助到天下顺之。"
    },
    "富贵不能淫": {
      background: "景春称赞公孙衍、张仪有威势，孟子则重新界定“大丈夫”，强调人格原则而非外在权势。",
      overview: "文章先反驳错误标准，再说明大丈夫应走正道，最后用三句排比明确精神品格。",
      thread: "景春发问 → 孟子反驳 → 居天下之广居 → 三不动摇",
      memory: "结尾三句是核心：富贵、贫贱、威武分别对应不惑、不移、不屈。"
    },
    "生于忧患，死于安乐": {
      background: "本章从个人成长谈到国家治理，论证磨难能够锻炼人才，安逸和缺少警醒可能导致衰亡。",
      overview: "文章先列举六位人物，再说明承担大任前要经受磨炼，继而从个人和国家两面推出结论。",
      thread: "六人事例 → 天降大任 → 困心衡虑而后作 → 国无忧患则亡",
      memory: "六个人名先成一组；磨炼部分按“心志—筋骨—体肤—身体—行为”记；最后从个人推到国家。"
    },
    "愚公移山": {
      background: "《愚公移山》选自《列子》，是一则寓言。它通过移山这一极端任务，讨论人的意志、眼光和行动力量。",
      overview: "愚公提出移山，全家商议并行动；智叟嘲笑，愚公以子孙无穷反驳，最终感动天帝移走两山。",
      thread: "苦于阻塞 → 聚室谋划 → 率众移山 → 智叟嘲笑 → 愚公反驳 → 天帝移山",
      memory: "把长文当故事背：原因、商议、行动、争辩、结局。人物对话是转折点，先分清“献疑”和“笑而止之”。"
    },
    "饮酒（其五）": {
      background: "陶渊明归隐田园后写下组诗《饮酒》。本诗表现身居人境却心远尘俗的生活状态。",
      overview: "诗人从“心远地自偏”的体悟写到采菊、见山、归鸟，最后落在难以言传的自然真意。",
      thread: "心远地偏 → 采菊见山 → 山气归鸟 → 欲辨忘言",
      memory: "先记一问一答，再记“采菊—见山”的动作，随后是傍晚景物，最后由景入理。"
    },
    "春望": {
      background: "安史之乱期间，杜甫困居被占领的长安。面对春日都城，他把国家破败、离乱思亲和个人衰老写在一起。",
      overview: "全诗从国都残破写到触景伤情，再写战乱中家书珍贵，最后以白发细节表现忧愁。",
      thread: "国破城春 → 感时恨别 → 烽火家书 → 白头不胜簪",
      memory: "四联顺序是城、花鸟、烽火、白头，镜头从大景一步步推到诗人自己。"
    },
    "雁门太守行": {
      background: "李贺用乐府旧题写边塞战争。诗中不拘泥于具体战事，而以强烈色彩和典故塑造守边将士。",
      overview: "敌军压境，守军严阵；战斗从白昼延续到夜晚，最终以报效君王的誓言结束。",
      thread: "黑云压城 → 日光照甲 → 半卷红旗 → 报君黄金台",
      memory: "按颜色记画面：黑、金、燕脂、紫、红、霜重、黄金。浓烈色彩就是诗的记忆骨架。"
    },
    "赤壁": {
      background: "杜牧经过赤壁古战场附近，借一件折戟怀想三国往事，并对历史成败提出带有想象的议论。",
      overview: "诗歌先由折戟辨认前朝，再设想若无东风，赤壁之战和两位人物的命运可能完全不同。",
      thread: "折戟沉沙 → 磨洗认前朝 → 东风助周郎 → 铜雀锁二乔",
      memory: "前两句写眼前物，后两句作历史假设。记住“折戟—东风—铜雀”三个节点。"
    },
    "渔家傲": {
      background: "李清照南渡后经历国破家亡。这首词借梦境写海天奇景，并表达对现实困境的不满和对理想境界的追求。",
      overview: "上片写海天相接、银河转动，梦中天帝问归处；下片写词人叹路长日暮，希望借长风飞往仙山。",
      thread: "海天梦境 → 天帝问归 → 嗟叹路长 → 风鹏正举",
      memory: "抓住梦中对话：天帝问，词人报；结尾从“九万里风鹏”一路飞向“三山”。"
    }
  };

  let rawData = [];
  let model = { lessons: [], pieces: [], pieceMap: new Map(), itemMap: new Map(), vocabItems: [] };
  let state = defaultState();
  let ui = {
    view: "overview",
    pieceId: null,
    selectedVocabId: null,
    highlights: true,
    memorizeIndex: 0,
    maskMode: 0,
    revealChunk: false,
    quiz: null,
    round: null,
    reviewFilter: "all",
    reviewFeedback: null
  };

  const app = document.getElementById("app");
  const moreMenu = document.getElementById("moreMenu");
  const notePanel = document.getElementById("notePanel");
  const toast = document.getElementById("toast");
  let toastTimer = null;

  function defaultState() {
    return { version: 1, items: {}, pieces: {}, pref: { view: "overview", pieceId: null }, roundCounter: 0 };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

  function normalizeAnswer(value) {
    return String(value || "").replace(/[\s，。！？；：、“”‘’（）《》〈〉·,.!?;:'"()]/g, "").trim();
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== "object") return defaultState();
      return {
        version: 1,
        items: saved.items && typeof saved.items === "object" ? saved.items : {},
        pieces: saved.pieces && typeof saved.pieces === "object" ? saved.pieces : {},
        pref: saved.pref && typeof saved.pref === "object" ? saved.pref : { view: "overview", pieceId: null },
        roundCounter: Number.isInteger(saved.roundCounter) ? saved.roundCounter : 0
      };
    } catch (error) {
      return defaultState();
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) {}
  }

  function getPieceState(pieceId) {
    if (!state.pieces[pieceId]) state.pieces[pieceId] = { started: false, learned: false, step: 0 };
    return state.pieces[pieceId];
  }

  function peekPieceState(pieceId) {
    return state.pieces[pieceId] || { started: false, learned: false, step: 0 };
  }

  function getItemRecord(itemId) {
    if (!state.items[itemId]) state.items[itemId] = { stage: 0, correct: 0, wrong: 0, lastCorrectRound: 0, lastSelf: "" };
    const record = state.items[itemId];
    record.stage = clamp(Number(record.stage) || 0, 0, 3);
    record.correct = Number(record.correct) || 0;
    record.wrong = Number(record.wrong) || 0;
    record.lastCorrectRound = Number(record.lastCorrectRound) || 0;
    return record;
  }

  function peekItemRecord(itemId) {
    return state.items[itemId] || { stage: 0, correct: 0, wrong: 0, lastCorrectRound: 0, lastSelf: "" };
  }

  function splitIntoChunks(content, isPoem, title) {
    const markers = CUSTOM_CHUNK_MARKERS[title];
    if (markers) {
      const chunks = [];
      let start = 0;
      markers.forEach(marker => {
        const markerIndex = content.indexOf(marker, start);
        if (markerIndex < 0) return;
        const end = markerIndex + marker.length;
        chunks.push({ content: content.slice(start, end), start, end });
        start = end;
      });
      if (start < content.length) chunks.push({ content: content.slice(start), start, end: content.length });
      if (chunks.length === markers.length + 1) return chunks;
    }
    const segments = [];
    const pattern = /[^。！？；]+[。！？；]?/g;
    let match;
    while ((match = pattern.exec(content))) {
      segments.push({ content: match[0], start: match.index, end: match.index + match[0].length });
    }
    if (!segments.length) return [{ content, start: 0, end: content.length }];
    if (isPoem) return segments;

    const chunks = [];
    let current = null;
    segments.forEach(segment => {
      if (!current) current = { ...segment };
      else if (current.content.length + segment.content.length <= 66) {
        current.content += segment.content;
        current.end = segment.end;
      } else {
        chunks.push(current);
        current = { ...segment };
      }
    });
    if (current) chunks.push(current);
    return chunks;
  }

  function sentenceContext(content, index) {
    const punctuation = "。！？；";
    let start = index;
    let end = index;
    while (start > 0 && !punctuation.includes(content[start - 1])) start -= 1;
    while (end < content.length && !punctuation.includes(content[end])) end += 1;
    if (end < content.length) end += 1;
    return { text: content.slice(start, end), start };
  }

  function buildModel(data) {
    const lessons = [];
    const pieces = [];
    const pieceMap = new Map();
    const itemMap = new Map();
    const vocabItems = [];

    data.forEach((lesson, lessonIndex) => {
      const lessonModel = { id: `l${lessonIndex + 1}`, title: lesson.lesson, pieces: [] };
      let offset = 0;
      lesson.texts.forEach((text, textIndex) => {
        const pieceId = `${lessonModel.id}-p${textIndex + 1}`;
        const pieceVocabs = lesson.vocabulary
          .filter(item => item.index >= offset && item.index < offset + text.content.length)
          .map((item, vocabIndex) => {
            const localIndex = item.index - offset;
            const context = sentenceContext(text.content, localIndex);
            return {
              ...item,
              id: `${pieceId}-v${vocabIndex + 1}`,
              pieceId,
              localIndex,
              context: context.text,
              contextStart: context.start,
              type: "vocab"
            };
          });
        const isPoem = POEM_TITLES.has(text.title);
        const chunks = splitIntoChunks(text.content, isPoem, text.title).map((chunk, chunkIndex) => ({
          ...chunk,
          id: `${pieceId}-c${chunkIndex + 1}`,
          pieceId,
          number: chunkIndex + 1,
          type: "chunk"
        }));
        const piece = {
          id: pieceId,
          lessonId: lessonModel.id,
          groupTitle: lesson.lesson,
          title: text.title,
          author: text.author,
          content: text.content,
          isPoem,
          vocabs: pieceVocabs,
          chunks
        };
        pieceVocabs.forEach(item => { itemMap.set(item.id, item); vocabItems.push(item); });
        chunks.forEach(item => itemMap.set(item.id, item));
        lessonModel.pieces.push(piece);
        pieces.push(piece);
        pieceMap.set(piece.id, piece);
        offset += text.content.length;
      });
      lessons.push(lessonModel);
    });
    return { lessons, pieces, pieceMap, itemMap, vocabItems };
  }

  function exposePiece(piece) {
    piece.vocabs.concat(piece.chunks).forEach(item => {
      const record = getItemRecord(item.id);
      record.stage = Math.max(1, record.stage);
    });
  }

  function pieceItems(piece) { return piece.vocabs.concat(piece.chunks); }

  function pieceStatus(piece) {
    const pieceState = peekPieceState(piece.id);
    if (!pieceState.started && !pieceState.learned) return { label: "未学习", className: "status-new" };
    if (!pieceState.learned) return { label: "学习中", className: "status-learning" };
    const records = pieceItems(piece).map(item => peekItemRecord(item.id));
    if (records.length && records.every(record => record.stage === 3)) return { label: "已掌握", className: "status-mastered" };
    if (records.some(record => record.wrong > 0 || record.stage === 1)) return { label: "复习中", className: "status-review" };
    return { label: "待巩固", className: "status-learning" };
  }

  function progressStats() {
    const learnedPieces = model.pieces.filter(piece => peekPieceState(piece.id).learned).length;
    const vocabMastered = model.vocabItems.filter(item => peekItemRecord(item.id).stage === 3).length;
    const chunkItems = model.pieces.flatMap(piece => piece.chunks);
    const chunksMastered = chunkItems.filter(item => peekItemRecord(item.id).stage === 3).length;
    return {
      learnedPieces,
      totalPieces: model.pieces.length,
      vocabMastered,
      totalVocab: model.vocabItems.length,
      chunksMastered,
      totalChunks: chunkItems.length
    };
  }

  function percent(done, total) { return total ? Math.round(done / total * 100) : 0; }

  function guideFor(piece) {
    return GUIDES[piece.title] || {
      background: `${piece.author}的作品。先结合正文和重点词理解内容，再进入分段记忆。`,
      overview: "阅读时注意篇章顺序、关键意象和反复出现的句式。",
      thread: "理解内容 → 找到顺序 → 分段记忆",
      memory: "先读懂每一层写了什么，再用首字和标点逐步撤掉提示。"
    };
  }

  function currentPiece() {
    return model.pieceMap.get(ui.pieceId) || model.pieces[0];
  }

  function setView(view) {
    ui.view = view;
    state.pref.view = view;
    saveState();
    ui.selectedVocabId = null;
    closeNote();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openLearn(pieceId) {
    const piece = model.pieceMap.get(pieceId);
    if (!piece) return;
    const pieceState = getPieceState(piece.id);
    pieceState.started = true;
    ui.pieceId = piece.id;
    ui.view = "learn";
    ui.memorizeIndex = 0;
    ui.maskMode = 0;
    ui.revealChunk = false;
    ui.quiz = null;
    state.pref.view = "learn";
    state.pref.pieceId = piece.id;
    saveState();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function continueLearning() {
    let piece = state.pref.pieceId ? model.pieceMap.get(state.pref.pieceId) : null;
    if (!piece || peekPieceState(piece.id).learned) {
      piece = model.pieces.find(candidate => !peekPieceState(candidate.id).learned) || model.pieces[0];
    }
    openLearn(piece.id);
  }

  function render() {
    document.querySelectorAll(".tab-button").forEach(button => {
      const active = button.dataset.view === ui.view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (ui.view === "overview") app.innerHTML = renderOverview();
    else if (ui.view === "learn") app.innerHTML = renderLearn();
    else if (ui.view === "review") app.innerHTML = renderReview();
    else app.innerHTML = renderFullText();
    const noteSlot = app.querySelector("[data-note-slot]");
    notePanel.hidden = !noteSlot;
    if (noteSlot) noteSlot.appendChild(notePanel);
    else document.body.appendChild(notePanel);
    renderNote();
  }

  function renderOverview() {
    const stats = progressStats();
    const weak = Object.keys(state.items).filter(id => {
      const record = peekItemRecord(id);
      return record.stage > 0 && record.stage < 3;
    }).length;
    return `
      <section class="overview-lead" aria-labelledby="overviewTitle">
        <div class="lead-copy">
          <p class="eyebrow">先读懂，再背熟</p>
          <h2 class="lead-title" id="overviewTitle">把每篇古诗文拆成可以掌握的小步</h2>
          <p class="lead-text">从背景和篇章顺序开始，点开重点词读懂原文，再用逐级遮挡完成背诵。复习只跟着掌握情况走，不按日期堆积。</p>
          <div class="lead-actions">
            <button class="primary-button" data-action="continue-learn">${stats.learnedPieces ? "继续学习" : "开始第一篇"}</button>
            <button class="secondary-button" data-action="start-review" ${stats.learnedPieces ? "" : "disabled"}>开始下一轮${weak ? ` · ${weak} 项待巩固` : ""}</button>
          </div>
        </div>
        <div class="memory-scene" aria-label="山水、行旅与诗文意象">
          <div class="scene-copy">
            <div class="scene-mark">山水</div>
            <div class="scene-caption">从三峡、江楼到边塞，把篇章顺序变成脑海中的行进路线。</div>
          </div>
        </div>
      </section>
      <section class="stats-grid" aria-label="学习进度">
        ${renderStat(stats.learnedPieces, stats.totalPieces, "已学习篇目")}
        ${renderStat(stats.vocabMastered, stats.totalVocab, "已掌握重点词")}
        ${renderStat(stats.chunksMastered, stats.totalChunks, "已掌握背诵段")}
      </section>
      <section aria-labelledby="catalogTitle">
        <div class="section-heading">
          <h2 id="catalogTitle">课文目录</h2>
          <p>7 个课组 · ${model.pieces.length} 篇具体篇目</p>
        </div>
        <div class="lesson-catalog">${model.lessons.map(renderLessonGroup).join("")}</div>
      </section>`;
  }

  function renderStat(done, total, label) {
    return `<div class="stat"><strong class="stat-value">${done}<small> / ${total}</small></strong><span class="stat-label">${label}</span><div class="stat-bar"><i style="width:${percent(done, total)}%"></i></div></div>`;
  }

  function renderLessonGroup(lesson) {
    const learned = lesson.pieces.filter(piece => peekPieceState(piece.id).learned).length;
    return `<section class="lesson-group">
      <div class="group-head"><span class="group-title">${escapeHtml(lesson.title)}</span><span class="group-count">${learned} / ${lesson.pieces.length} 篇已学</span></div>
      <div>${lesson.pieces.map(piece => {
        const status = pieceStatus(piece);
        return `<button class="piece-row" data-action="open-learn" data-piece="${piece.id}">
          <span><span class="piece-title">${escapeHtml(piece.title)}</span><span class="piece-author"> · ${escapeHtml(piece.author)}</span></span>
          <span class="piece-meta">${piece.content.length} 字 · ${piece.vocabs.length} 词</span>
          <span class="status-chip ${status.className}">${status.label}</span>
        </button>`;
      }).join("")}</div>
    </section>`;
  }

  function pieceOptions(selectedId, learnedOnly) {
    return model.lessons.map(lesson => {
      const pieces = lesson.pieces.filter(piece => !learnedOnly || peekPieceState(piece.id).learned);
      if (!pieces.length) return "";
      return `<optgroup label="${escapeHtml(lesson.title)}">${pieces.map(piece => `<option value="${piece.id}" ${piece.id === selectedId ? "selected" : ""}>${escapeHtml(piece.title)} · ${escapeHtml(piece.author)}</option>`).join("")}</optgroup>`;
    }).join("");
  }

  function renderPieceHeader(piece) {
    return `<div class="view-head">
      <div class="view-head-main">
        <p class="view-kicker">${escapeHtml(piece.groupTitle)}</p>
        <h2 class="view-title">${escapeHtml(piece.title)}</h2>
        <p class="view-byline">${escapeHtml(piece.author)} · ${piece.content.length} 字 · ${piece.vocabs.length} 个重点词</p>
      </div>
      <div class="view-tools">
        <label class="sr-only" for="pieceSelect">选择篇目</label>
        <select class="piece-select" id="pieceSelect" data-change="piece">${pieceOptions(piece.id, false)}</select>
      </div>
    </div>`;
  }

  function renderLearn() {
    const piece = currentPiece();
    ui.pieceId = piece.id;
    const pieceState = peekPieceState(piece.id);
    const step = clamp(pieceState.step || 0, 0, 3);
    return `${renderPieceHeader(piece)}${renderStepper(step)}${renderLearnStep(piece, step)}`;
  }

  function renderStepper(step) {
    const labels = ["先了解", "读原文", "分段记", "学完测"];
    return `<nav class="stepper" aria-label="首次学习步骤">${labels.map((label, index) => `<button class="step-button ${index === step ? "active" : ""} ${index < step ? "complete" : ""}" data-action="learn-step" data-step="${index}"><span class="step-number">${index < step ? "✓" : index + 1}</span>${label}</button>`).join("")}</nav>`;
  }

  function renderLearnStep(piece, step) {
    if (step === 0) return renderGuide(piece);
    if (step === 1) return renderReading(piece, true);
    if (step === 2) return renderMemorize(piece);
    return renderQuiz(piece);
  }

  function renderGuide(piece) {
    const guide = guideFor(piece);
    return `<div class="guide-layout">
      <section class="guide-primary">
        <p class="guide-label">写作背景</p>
        <h3>先知道这篇为什么写</h3>
        <p>${escapeHtml(guide.background)}</p>
        <p class="guide-label" style="margin-top:24px">内容梳理</p>
        <p>${escapeHtml(guide.overview)}</p>
        <div class="guide-facts">
          <div class="guide-fact"><strong>${piece.content.length}</strong><span>正文总字数</span></div>
          <div class="guide-fact"><strong>${piece.vocabs.length}</strong><span>重点词</span></div>
          <div class="guide-fact"><strong>${piece.chunks.length}</strong><span>背诵分段</span></div>
        </div>
        <div class="guide-action"><button class="primary-button" data-action="next-learn-step">进入原文</button></div>
      </section>
      <aside class="guide-aside">
        <p class="guide-label">篇章路线</p>
        <h3>${escapeHtml(guide.thread)}</h3>
        <p class="guide-label" style="margin-top:26px">背诵抓手</p>
        <p>${escapeHtml(guide.memory)}</p>
      </aside>
    </div>`;
  }

  function markedText(piece, highlights) {
    if (!highlights || !piece.vocabs.length) return escapeHtml(piece.content);
    const ranges = piece.vocabs.slice().sort((a, b) => a.localIndex - b.localIndex || b.word.length - a.word.length);
    let cursor = 0;
    let html = "";
    ranges.forEach(vocab => {
      if (vocab.localIndex < cursor) return;
      html += escapeHtml(piece.content.slice(cursor, vocab.localIndex));
      html += `<button class="vocab-mark ${ui.selectedVocabId === vocab.id ? "active" : ""}" data-action="show-vocab" data-vocab="${vocab.id}" title="查看“${escapeHtml(vocab.word)}”的解释">${escapeHtml(vocab.word)}</button>`;
      cursor = vocab.localIndex + vocab.word.length;
    });
    html += escapeHtml(piece.content.slice(cursor));
    return html;
  }

  function renderReading(piece, learningMode) {
    return `<div class="reader-grid">
      <article class="reading-paper">
        <div class="reading-toolbar">
          <span class="reading-mode">${learningMode ? "点击红色下划线词语查看解释" : "全文浏览不会改变学习进度"}</span>
          <label class="toggle-label"><input type="checkbox" data-change="highlights" ${ui.highlights ? "checked" : ""}>显示重点词</label>
        </div>
        <p class="classical-text">${markedText(piece, ui.highlights)}</p>
        ${learningMode ? `<div class="practice-footer"><button class="text-button" data-action="learn-step" data-step="0">返回导学</button><button class="primary-button" data-action="next-learn-step">我已读懂，开始分段记</button></div>` : ""}
      </article>
      <aside data-note-slot aria-label="词语解释"></aside>
    </div>`;
  }

  function renderNote() {
    const vocab = model.itemMap.get(ui.selectedVocabId);
    if (!vocab || vocab.type !== "vocab") {
      notePanel.classList.remove("open");
      notePanel.innerHTML = `<div class="note-empty">点击正文中带红色下划线的词语，这里会显示课本释义和所在原句。</div>`;
      return;
    }
    const piece = model.pieceMap.get(vocab.pieceId);
    const index = piece.vocabs.findIndex(item => item.id === vocab.id);
    notePanel.innerHTML = `<button class="note-close" data-action="close-note" aria-label="关闭解释">×</button>
      <p class="note-word">${escapeHtml(vocab.word)}</p>
      <p class="note-explanation">${escapeHtml(vocab.explanation)}</p>
      <p class="note-context">${escapeHtml(vocab.context)}</p>
      <div class="note-nav">
        <button class="secondary-button button-small" data-action="note-prev" ${index <= 0 ? "disabled" : ""}>上一个</button>
        <button class="secondary-button button-small" data-action="note-next" ${index >= piece.vocabs.length - 1 ? "disabled" : ""}>下一个</button>
      </div>`;
    notePanel.classList.add("open");
  }

  function closeNote() {
    ui.selectedVocabId = null;
    notePanel.classList.remove("open");
  }

  function maskKeywords(piece, chunk) {
    const ranges = piece.vocabs
      .filter(vocab => vocab.localIndex >= chunk.start && vocab.localIndex < chunk.end)
      .map(vocab => ({ start: vocab.localIndex - chunk.start, end: vocab.localIndex - chunk.start + vocab.word.length }))
      .sort((a, b) => a.start - b.start);
    if (!ranges.length) return maskFirstChars(chunk.content);
    let cursor = 0;
    let html = "";
    ranges.forEach(range => {
      if (range.start < cursor) return;
      html += escapeHtml(chunk.content.slice(cursor, range.start));
      html += `<span class="memory-blank">${escapeHtml(chunk.content.slice(range.start, range.end))}</span>`;
      cursor = range.end;
    });
    return html + escapeHtml(chunk.content.slice(cursor));
  }

  function maskFirstChars(content) {
    const punctuation = "，。！？；：、";
    let showNext = true;
    return Array.from(content).map(char => {
      if (punctuation.includes(char)) { showNext = true; return escapeHtml(char); }
      if (showNext && char.trim()) { showNext = false; return escapeHtml(char); }
      return char.trim() ? `<span class="masked-char">＿</span>` : char;
    }).join("");
  }

  function renderMemorize(piece) {
    const index = clamp(ui.memorizeIndex, 0, piece.chunks.length - 1);
    ui.memorizeIndex = index;
    const chunk = piece.chunks[index];
    const record = getItemRecord(chunk.id);
    const modes = ["完整原文", "遮重点词", "首字提示", "完全遮挡"];
    let content;
    if (ui.maskMode === 0 || ui.revealChunk) content = escapeHtml(chunk.content);
    else if (ui.maskMode === 1) content = maskKeywords(piece, chunk);
    else if (ui.maskMode === 2) content = maskFirstChars(chunk.content);
    else content = `<span class="hidden-prompt">先在心里或大声背出这一段，再查看原文核对。</span>`;
    return `<div class="memorize-layout">
      <nav aria-label="背诵分段">
        <div class="chunk-list">${piece.chunks.map((item, itemIndex) => `<button class="chunk-button ${itemIndex === index ? "active" : ""}" data-action="select-chunk" data-index="${itemIndex}"><span>第 ${itemIndex + 1} 段</span><span class="tiny-chip">${STAGE_LABELS[peekItemRecord(item.id).stage]}</span></button>`).join("")}</div>
      </nav>
      <section class="practice-surface">
        <p class="guide-label">第 ${index + 1} / ${piece.chunks.length} 段</p>
        <h3>逐步撤掉提示</h3>
        <div class="mode-control">${modes.map((label, mode) => `<button class="mode-button ${ui.maskMode === mode ? "active" : ""}" data-action="mask-mode" data-mode="${mode}">${label}</button>`).join("")}</div>
        <div class="chunk-stage"><p class="chunk-text">${content}</p></div>
        ${ui.maskMode === 3 ? `<button class="secondary-button button-small" data-action="reveal-chunk">${ui.revealChunk ? "隐藏原文" : "查看原文"}</button>` : ""}
        <p class="reading-mode">核对后选择实际回忆情况。自评会影响薄弱项顺序，但不会直接判定掌握。</p>
        <div class="rate-row">
          <button class="rate-button good" data-action="rate-chunk" data-rate="good">完全想起</button>
          <button class="rate-button hint" data-action="rate-chunk" data-rate="hint">提示后想起</button>
          <button class="rate-button bad" data-action="rate-chunk" data-rate="bad">没想起</button>
        </div>
        <div class="practice-footer">
          <span class="reading-mode">当前记录：${record.lastSelf ? ({ good: "完全想起", hint: "提示后想起", bad: "没想起" })[record.lastSelf] : "尚未自评"}</span>
          ${index < piece.chunks.length - 1 ? `<button class="primary-button" data-action="next-chunk">下一段</button>` : `<button class="primary-button" data-action="next-learn-step">进入首次检测</button>`}
        </div>
      </section>
    </div>`;
  }

  function makeOptions(correct, pool, seed) {
    const unique = Array.from(new Set(pool.filter(value => value && value !== correct)));
    unique.sort((a, b) => hashString(a + seed) - hashString(b + seed));
    const options = [correct].concat(unique.slice(0, 3));
    return options.sort((a, b) => hashString(a + seed + "x") - hashString(b + seed + "x"));
  }

  function makeQuiz(piece) {
    const selected = [];
    const vocabCount = Math.min(3, piece.vocabs.length);
    for (let i = 0; i < vocabCount; i += 1) {
      const index = Math.min(piece.vocabs.length - 1, Math.floor(i * piece.vocabs.length / vocabCount));
      const vocab = piece.vocabs[index];
      selected.push({
        type: "mcq",
        itemId: vocab.id,
        prompt: `“${vocab.word}”在本文中的意思是？`,
        options: makeOptions(vocab.explanation, model.vocabItems.map(item => item.explanation), vocab.id),
        answer: vocab.explanation,
        context: vocab.context
      });
    }
    piece.vocabs.slice().reverse().slice(0, Math.min(2, piece.vocabs.length)).forEach(vocab => {
      selected.push({
        type: "input",
        itemId: vocab.id,
        prompt: "补全原文中的重点词",
        context: vocab.context.replace(vocab.word, "____"),
        answer: vocab.word,
        explanation: vocab.explanation
      });
    });
    return { pieceId: piece.id, questions: selected, index: 0, feedback: null, results: [] };
  }

  function renderQuiz(piece) {
    if (peekPieceState(piece.id).learned && !ui.quiz) {
      return `<div class="quiz-wrap"><section class="practice-surface quiz">
        <p class="guide-label">首次学习已完成</p>
        <h3>这篇正在轮次复习中</h3>
        <p class="lead-text">可以回到原文或分段记忆，也可以直接练习本篇尚未掌握的重点词和背诵段。</p>
        <div class="lead-actions"><button class="primary-button" data-action="review-piece" data-piece="${piece.id}">复习本篇</button><button class="secondary-button" data-action="learn-step" data-step="1">查看原文</button><button class="secondary-button" data-action="learn-step" data-step="2">分段背诵</button></div>
      </section></div>`;
    }
    if (!ui.quiz || ui.quiz.pieceId !== piece.id) ui.quiz = makeQuiz(piece);
    const quiz = ui.quiz;
    if (quiz.index >= quiz.questions.length) return renderQuizSummary(piece, quiz);
    const question = quiz.questions[quiz.index];
    const progress = percent(quiz.index, quiz.questions.length);
    return `<div class="quiz-wrap">
      <div class="quiz-progress"><span>${quiz.index + 1} / ${quiz.questions.length}</span><div class="progress-track"><i style="width:${progress}%"></i></div></div>
      <section class="practice-surface quiz">
        <span class="question-label">首次检测</span>
        <h3 class="question-prompt">${escapeHtml(question.prompt)}</h3>
        ${question.context ? `<div class="question-context">${escapeHtml(question.context)}</div>` : ""}
        ${question.type === "mcq" ? renderQuizChoices(question, quiz.feedback) : renderQuizInput(question, quiz.feedback)}
        ${quiz.feedback ? renderFeedback(quiz.feedback, question) : ""}
        ${quiz.feedback ? `<div class="question-actions"><button class="primary-button" data-action="quiz-next">${quiz.index === quiz.questions.length - 1 ? "查看结果" : "下一题"}</button></div>` : ""}
      </section>
    </div>`;
  }

  function renderQuizChoices(question, feedback) {
    return `<div class="choices">${question.options.map((option, index) => {
      let cls = "";
      if (feedback && option === feedback.answer) cls = `selected ${feedback.correct ? "correct" : "wrong"}`;
      return `<button class="choice-button ${cls}" data-action="quiz-choice" data-index="${index}" ${feedback ? "disabled" : ""}>${escapeHtml(option)}</button>`;
    }).join("")}</div>`;
  }

  function renderQuizInput(question, feedback) {
    return `<form class="answer-form" data-form="quiz"><label class="sr-only" for="quizAnswer">填写答案</label><input class="answer-input" id="quizAnswer" name="answer" autocomplete="off" placeholder="输入被遮住的词语" ${feedback ? "disabled" : ""}><button class="primary-button" type="submit" ${feedback ? "disabled" : ""}>核对</button></form>`;
  }

  function renderFeedback(feedback, question) {
    return `<div class="feedback ${feedback.correct ? "correct" : "wrong"}"><strong>${feedback.correct ? "回答正确" : `正确答案：${escapeHtml(question.answer)}`}</strong>${question.explanation ? escapeHtml(question.explanation) : escapeHtml(model.itemMap.get(question.itemId).explanation || "")}</div>`;
  }

  function answerQuiz(value) {
    const quiz = ui.quiz;
    if (!quiz || quiz.feedback) return;
    const question = quiz.questions[quiz.index];
    const correct = normalizeAnswer(value) === normalizeAnswer(question.answer);
    quiz.feedback = { correct, answer: value };
    quiz.results.push({ itemId: question.itemId, correct });
    const record = getItemRecord(question.itemId);
    record.stage = Math.max(1, record.stage);
    if (correct) record.correct += 1;
    else record.wrong += 1;
    saveState();
    render();
  }

  function renderQuizSummary(piece, quiz) {
    const correct = quiz.results.filter(result => result.correct).length;
    return `<div class="quiz-wrap"><section class="practice-surface quiz">
      <p class="guide-label">首次学习完成</p>
      <h3>这篇已经进入轮次复习</h3>
      <p class="lead-text">本次答对 ${correct} / ${quiz.questions.length} 题。答错内容会优先出现在下一轮，不需要现在反复刷到全对。</p>
      <div class="summary-grid">
        <div class="summary-item"><strong>${piece.vocabs.length}</strong><span>重点词已进入队列</span></div>
        <div class="summary-item"><strong>${piece.chunks.length}</strong><span>背诵段已进入队列</span></div>
        <div class="summary-item"><strong>${quiz.questions.length - correct}</strong><span>本次薄弱项</span></div>
      </div>
      <div class="lead-actions"><button class="primary-button" data-action="finish-learning">完成首次学习</button><button class="secondary-button" data-action="learn-step" data-step="1">再看一遍原文</button></div>
    </section></div>`;
  }

  function finishLearning(piece) {
    const pieceState = getPieceState(piece.id);
    pieceState.started = true;
    pieceState.learned = true;
    pieceState.step = 3;
    exposePiece(piece);
    saveState();
    showToast(`《${piece.title}》已完成首次学习`);
    setView("overview");
  }

  function eligibleReviewItems(filter) {
    const allowedPieces = new Set(model.pieces.filter(piece => peekPieceState(piece.id).learned && (filter === "all" || piece.id === filter)).map(piece => piece.id));
    return Array.from(model.itemMap.values()).filter(item => {
      const record = peekItemRecord(item.id);
      return allowedPieces.has(item.pieceId) && record.stage > 0 && record.stage < 3;
    });
  }

  function startRound() {
    const eligible = eligibleReviewItems(ui.reviewFilter);
    if (!eligible.length) { ui.round = null; render(); return; }
    state.roundCounter += 1;
    const roundId = state.roundCounter;
    eligible.sort((a, b) => {
      const ra = peekItemRecord(a.id);
      const rb = peekItemRecord(b.id);
      const pa = (3 - ra.stage) * 100 + ra.wrong * 8 + (hashString(a.id + roundId) % 13);
      const pb = (3 - rb.stage) * 100 + rb.wrong * 8 + (hashString(b.id + roundId) % 13);
      return pb - pa;
    });
    const queue = eligible.slice(0, 10).map(item => ({ itemId: item.id, retry: false }));
    ui.round = { id: roundId, queue, index: 0, initialCount: queue.length, attempts: {}, results: [], complete: false };
    ui.reviewFeedback = null;
    saveState();
    render();
  }

  function renderReview() {
    const learnedPieces = model.pieces.filter(piece => peekPieceState(piece.id).learned);
    if (!learnedPieces.length) {
      return `<div class="empty-state"><h3>先完成一篇首次学习</h3><p>复习轮次只会使用已经读懂并完成首次检测的内容。</p><button class="primary-button" data-action="continue-learn">开始第一篇</button></div>`;
    }
    if (ui.round && ui.round.complete) return renderRoundSummary();
    if (ui.round) return renderRoundQuestion();
    const eligible = eligibleReviewItems(ui.reviewFilter);
    const mastered = Object.values(state.items).filter(record => record.stage === 3).length;
    return `<div class="view-head"><div><p class="view-kicker">按掌握情况循环</p><h2 class="view-title">下一轮复习</h2><p class="view-byline">没有日期和逾期任务，每轮最多 10 个内容。</p></div></div>
      <div class="review-intro">
        <section class="review-surface">
          <h3>${eligible.length ? `有 ${eligible.length} 项可以继续巩固` : "当前范围已经掌握"}</h3>
          <p>薄弱内容优先出现；答错后会在本轮稍后换一种方式再练。只有在不同轮次中无提示答对，才会进入已掌握。</p>
          <div class="review-start-row">
            <label class="sr-only" for="reviewFilter">选择复习范围</label>
            <select class="review-select" id="reviewFilter" data-change="review-filter"><option value="all">全部已学篇目</option>${pieceOptions(ui.reviewFilter, true)}</select>
            <button class="primary-button" data-action="begin-round" ${eligible.length ? "" : "disabled"}>开始本轮</button>
          </div>
        </section>
        <aside class="round-guide"><strong>${mastered}</strong><span>词语与背诵段已经跨轮掌握。已掌握内容默认退出队列，不会挤占新一轮。</span></aside>
      </div>`;
  }

  function reviewQuestion(entry) {
    const item = model.itemMap.get(entry.itemId);
    const record = peekItemRecord(item.id);
    if (item.type === "vocab") {
      if (record.stage === 1 && !entry.retry) {
        return {
          kind: "mcq", item, label: "重点词 · 选择词义",
          prompt: `“${item.word}”在原文中的意思是？`,
          options: makeOptions(item.explanation, model.vocabItems.map(vocab => vocab.explanation), item.id + ui.round.id),
          answer: item.explanation, context: item.context
        };
      }
      return { kind: "input", item, label: entry.retry ? "错项再练" : "重点词 · 主动回忆", prompt: item.explanation, answer: item.word, context: item.context };
    }
    return { kind: "recall", item, label: entry.retry ? "背诵段 · 再试一次" : "背诵段 · 主动回忆", prompt: record.stage === 1 ? maskFirstChars(item.content) : "", answer: item.content };
  }

  function renderRoundQuestion() {
    const round = ui.round;
    if (round.index >= round.queue.length) { round.complete = true; return renderRoundSummary(); }
    const entry = round.queue[round.index];
    const question = reviewQuestion(entry);
    const piece = model.pieceMap.get(question.item.pieceId);
    const feedback = ui.reviewFeedback;
    return `<div class="review-wrap">
      <div class="view-head"><div><p class="view-kicker">第 ${round.id} 轮</p><h2 class="view-title">${escapeHtml(piece.title)}</h2><p class="view-byline">${escapeHtml(piece.author)} · ${escapeHtml(question.label)}</p></div></div>
      <div class="round-progress"><span>${round.index + 1} / ${round.queue.length}</span><div class="progress-track"><i style="width:${percent(round.index, round.queue.length)}%"></i></div></div>
      <section class="review-surface">
        <span class="question-label">${escapeHtml(question.label)}</span>
        ${question.kind === "recall" ? renderRecallQuestion(question, feedback) : `<h3 class="question-prompt">${escapeHtml(question.prompt)}</h3>${question.context ? `<div class="question-context">${escapeHtml(question.context)}</div>` : ""}${question.kind === "mcq" ? renderReviewChoices(question, feedback) : renderReviewInput(feedback)}`}
        ${feedback ? renderReviewFeedback(feedback, question) : ""}
        ${feedback ? `<div class="question-actions"><button class="primary-button" data-action="review-next">下一题</button></div>` : ""}
      </section>
    </div>`;
  }

  function renderReviewChoices(question, feedback) {
    return `<div class="choices">${question.options.map((option, index) => {
      let cls = "";
      if (feedback && option === feedback.answer) cls = `selected ${feedback.correct ? "correct" : "wrong"}`;
      return `<button class="choice-button ${cls}" data-action="review-choice" data-index="${index}" ${feedback ? "disabled" : ""}>${escapeHtml(option)}</button>`;
    }).join("")}</div>`;
  }

  function renderReviewInput(feedback) {
    return `<form class="answer-form" data-form="review"><label class="sr-only" for="reviewAnswer">填写词语</label><input class="answer-input" id="reviewAnswer" name="answer" autocomplete="off" placeholder="根据解释写出词语" ${feedback ? "disabled" : ""}><button class="primary-button" type="submit" ${feedback ? "disabled" : ""}>核对</button></form>`;
  }

  function renderRecallQuestion(question, feedback) {
    const showAnswer = ui.round.revealed || feedback;
    return `<h3 class="question-prompt">背出这一段，再按实际情况作答</h3>
      <div class="recall-mask">${question.prompt || "原文已完全遮挡，请从头背出这一段。"}</div>
      ${showAnswer ? `<div class="recall-answer">${escapeHtml(question.answer)}</div>` : `<button class="secondary-button button-small" data-action="review-reveal" style="margin-top:14px">查看提示与原文</button>`}
      ${!feedback ? `<div class="review-rate-row">
        <button class="rate-button good" data-action="review-rate" data-rate="good">完整想起</button>
        <button class="rate-button hint" data-action="review-rate" data-rate="hint">提示后想起</button>
        <button class="rate-button bad" data-action="review-rate" data-rate="bad">没想起</button>
      </div>` : ""}`;
  }

  function renderReviewFeedback(feedback, question) {
    const item = question.item;
    const detail = item.type === "vocab" ? item.explanation : item.content;
    return `<div class="feedback ${feedback.correct ? "correct" : "wrong"}"><strong>${feedback.correct ? (feedback.usedHint ? "提示后想起，本次不升级" : `回答正确 · ${STAGE_LABELS[feedback.newStage]}`) : "这项会在本轮稍后再出现"}</strong>${escapeHtml(detail)}</div>`;
  }

  function answerReview(value, usedHint, forcedCorrect) {
    const round = ui.round;
    if (!round || ui.reviewFeedback) return;
    const entry = round.queue[round.index];
    const question = reviewQuestion(entry);
    const correct = typeof forcedCorrect === "boolean" ? forcedCorrect : normalizeAnswer(value) === normalizeAnswer(question.answer);
    const record = getItemRecord(entry.itemId);
    round.attempts[entry.itemId] = (round.attempts[entry.itemId] || 0) + 1;
    const oldStage = record.stage;
    if (correct) {
      record.correct += 1;
      if (!usedHint && record.lastCorrectRound !== round.id) {
        record.stage = Math.min(3, record.stage + 1);
        record.lastCorrectRound = round.id;
      }
    } else {
      record.wrong += 1;
      record.stage = Math.max(1, record.stage - 1);
      if (round.attempts[entry.itemId] < 2) {
        const insertAt = Math.min(round.queue.length, round.index + 4);
        round.queue.splice(insertAt, 0, { itemId: entry.itemId, retry: true });
      }
    }
    const mastered = oldStage < 3 && record.stage === 3;
    round.results.push({ itemId: entry.itemId, correct, usedHint, oldStage, newStage: record.stage, mastered });
    ui.reviewFeedback = { correct, usedHint, answer: value, newStage: record.stage };
    saveState();
    render();
  }

  function nextReviewQuestion() {
    if (!ui.round) return;
    ui.round.index += 1;
    ui.round.revealed = false;
    ui.reviewFeedback = null;
    if (ui.round.index >= ui.round.queue.length) ui.round.complete = true;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderRoundSummary() {
    const results = ui.round.results;
    const upgrades = results.filter(result => result.newStage > result.oldStage).length;
    const mastered = results.filter(result => result.mastered).length;
    const wrong = results.filter(result => !result.correct).length;
    const remaining = eligibleReviewItems(ui.reviewFilter).length;
    return `<div class="review-wrap"><section class="review-surface">
      <p class="guide-label">第 ${ui.round.id} 轮完成</p>
      <h3>这一轮已经结束</h3>
      <p>错项已经完成本轮内的再次练习。仍未掌握的内容会在下一轮继续优先出现。</p>
      <div class="summary-grid">
        <div class="summary-item"><strong>${upgrades}</strong><span>掌握阶段提升</span></div>
        <div class="summary-item"><strong>${mastered}</strong><span>新掌握</span></div>
        <div class="summary-item"><strong>${wrong}</strong><span>错误记录</span></div>
      </div>
      <div class="lead-actions"><button class="primary-button" data-action="next-round" ${remaining ? "" : "disabled"}>${remaining ? `继续下一轮 · ${remaining} 项` : "当前范围已掌握"}</button><button class="secondary-button" data-action="go-overview">返回总览</button></div>
    </section></div>`;
  }

  function renderFullText() {
    const piece = currentPiece();
    const guide = guideFor(piece);
    return `<div class="view-head"><div><p class="view-kicker">自由查阅</p><h2 class="view-title">全文与注释</h2><p class="view-byline">浏览不会改变学习进度</p></div></div>
      <div class="fulltext-controls">
        <select class="piece-select" data-change="piece">${pieceOptions(piece.id, false)}</select>
        <div class="control-group"><label class="toggle-label"><input type="checkbox" data-change="highlights" ${ui.highlights ? "checked" : ""}>显示重点词</label><button class="secondary-button button-small" data-action="open-learn" data-piece="${piece.id}">进入学习</button></div>
      </div>
      <div class="reader-grid">
        <article class="reading-paper">
          <p class="view-kicker">${escapeHtml(piece.groupTitle)}</p>
          <h2 class="view-title">${escapeHtml(piece.title)}</h2>
          <p class="view-byline" style="margin-bottom:24px">${escapeHtml(piece.author)}</p>
          <p class="classical-text">${markedText(piece, ui.highlights)}</p>
          <div class="guide-details">
            <details><summary>写作背景</summary><p>${escapeHtml(guide.background)}</p></details>
            <details><summary>内容梳理</summary><p>${escapeHtml(guide.overview)}</p></details>
            <details><summary>篇章路线</summary><p>${escapeHtml(guide.thread)}</p></details>
            <details><summary>背诵提示</summary><p>${escapeHtml(guide.memory)}</p></details>
          </div>
        </article>
        <aside data-note-slot aria-label="词语解释"></aside>
      </div>`;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1900);
  }

  function openProgressModal(mode) {
    const modal = document.getElementById("progressModal");
    const title = document.getElementById("progressTitle");
    const body = document.getElementById("progressBody");
    const textarea = document.getElementById("progressTextarea");
    const action = document.getElementById("progressAction");
    const note = document.getElementById("progressNote");
    note.textContent = "";
    note.className = "note";
    if (mode === "export") {
      title.textContent = "导出学习进度";
      body.textContent = "复制下面的进度文本，可以在另一台设备导入。";
      textarea.value = JSON.stringify({ app: APP_ID, version: 1, state }, null, 2);
      textarea.readOnly = true;
      action.textContent = "复制进度";
      action.dataset.action = "copy-progress";
    } else {
      title.textContent = "导入学习进度";
      body.textContent = "导入会替换当前页面的全部本机进度，请先确认内容来源。";
      textarea.value = "";
      textarea.readOnly = false;
      action.textContent = "校验并导入";
      action.dataset.action = "apply-import";
    }
    modal.classList.add("show");
    setTimeout(() => { textarea.focus(); if (mode === "export") textarea.select(); }, 30);
  }

  async function copyProgress() {
    const textarea = document.getElementById("progressTextarea");
    const note = document.getElementById("progressNote");
    let ok = false;
    try { await navigator.clipboard.writeText(textarea.value); ok = true; } catch (error) {
      textarea.focus(); textarea.select();
      try { ok = document.execCommand("copy"); } catch (ignored) {}
    }
    note.textContent = ok ? "已复制到剪贴板。" : "无法自动复制，请手动全选上面的文本。";
    note.className = `note ${ok ? "ok" : "err"}`;
  }

  function applyImport() {
    const note = document.getElementById("progressNote");
    try {
      const parsed = JSON.parse(document.getElementById("progressTextarea").value.trim());
      if (!parsed || parsed.app !== APP_ID || !parsed.state || typeof parsed.state !== "object") throw new Error("这不是八年级古诗文学习器的进度文件。");
      state = {
        ...defaultState(),
        ...parsed.state,
        items: parsed.state.items && typeof parsed.state.items === "object" ? parsed.state.items : {},
        pieces: parsed.state.pieces && typeof parsed.state.pieces === "object" ? parsed.state.pieces : {},
        pref: parsed.state.pref && typeof parsed.state.pref === "object" ? parsed.state.pref : { view: "overview", pieceId: null }
      };
      saveState();
      document.getElementById("progressModal").classList.remove("show");
      ui.view = "overview";
      ui.round = null;
      render();
      showToast("学习进度已导入");
    } catch (error) {
      note.textContent = error.message || "进度文本无法解析。";
      note.className = "note err";
    }
  }

  function applySyncData(data) {
    const pref = data && data.pref && typeof data.pref === "object" ? data.pref : {};
    state.items = data && data.status && typeof data.status === "object" ? data.status : {};
    state.pieces = pref.pieces && typeof pref.pieces === "object" ? pref.pieces : {};
    state.pref = pref.ui && typeof pref.ui === "object" ? pref.ui : { view: "overview", pieceId: null };
    state.roundCounter = Number(pref.roundCounter) || 0;
    saveState();
    ui.view = "overview";
    ui.round = null;
    render();
  }

  function bindEvents() {
    document.addEventListener("click", event => {
      const target = event.target.closest("[data-action]");
      if (!target) {
        if (!event.target.closest(".header-actions")) moreMenu.hidden = true;
        return;
      }
      const action = target.dataset.action;
      if (action === "more") moreMenu.hidden = !moreMenu.hidden;
      else if (action === "continue-learn") continueLearning();
      else if (action === "open-learn") openLearn(target.dataset.piece);
      else if (action === "start-review") { ui.view = "review"; ui.round = null; state.pref.view = "review"; saveState(); startRound(); }
      else if (action === "begin-round" || action === "next-round") startRound();
      else if (action === "go-overview") setView("overview");
      else if (action === "learn-step") {
        const piece = currentPiece();
        const pieceState = getPieceState(piece.id);
        pieceState.step = Number(target.dataset.step);
        if (pieceState.step >= 2) exposePiece(piece);
        ui.quiz = null;
        saveState(); render(); window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (action === "next-learn-step") {
        const piece = currentPiece();
        const pieceState = getPieceState(piece.id);
        pieceState.step = Math.min(3, (pieceState.step || 0) + 1);
        if (pieceState.step >= 2) exposePiece(piece);
        closeNote();
        ui.revealChunk = false;
        saveState(); render(); window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (action === "show-vocab") { ui.selectedVocabId = target.dataset.vocab; render(); }
      else if (action === "close-note") closeNote();
      else if (action === "note-prev" || action === "note-next") {
        const vocab = model.itemMap.get(ui.selectedVocabId);
        const piece = model.pieceMap.get(vocab.pieceId);
        const index = piece.vocabs.findIndex(item => item.id === vocab.id) + (action === "note-prev" ? -1 : 1);
        if (piece.vocabs[index]) { ui.selectedVocabId = piece.vocabs[index].id; render(); }
      } else if (action === "select-chunk") { ui.memorizeIndex = Number(target.dataset.index); ui.revealChunk = false; render(); }
      else if (action === "next-chunk") { ui.memorizeIndex += 1; ui.revealChunk = false; render(); }
      else if (action === "mask-mode") { ui.maskMode = Number(target.dataset.mode); ui.revealChunk = false; render(); }
      else if (action === "reveal-chunk") { ui.revealChunk = !ui.revealChunk; render(); }
      else if (action === "rate-chunk") {
        const piece = currentPiece();
        const chunk = piece.chunks[ui.memorizeIndex];
        const record = getItemRecord(chunk.id);
        record.stage = Math.max(1, record.stage);
        record.lastSelf = target.dataset.rate;
        if (target.dataset.rate === "bad") record.wrong += 1;
        saveState(); showToast("已记录本段回忆情况"); render();
      } else if (action === "quiz-choice") {
        const question = ui.quiz.questions[ui.quiz.index];
        answerQuiz(question.options[Number(target.dataset.index)]);
      } else if (action === "quiz-next") { ui.quiz.index += 1; ui.quiz.feedback = null; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
      else if (action === "finish-learning") finishLearning(currentPiece());
      else if (action === "review-piece") {
        ui.reviewFilter = target.dataset.piece;
        ui.view = "review";
        ui.round = null;
        state.pref.view = "review";
        saveState();
        startRound();
      }
      else if (action === "review-choice") {
        const entry = ui.round.queue[ui.round.index];
        const question = reviewQuestion(entry);
        answerReview(question.options[Number(target.dataset.index)], false);
      } else if (action === "review-reveal") { ui.round.revealed = true; render(); }
      else if (action === "review-rate") {
        const rate = target.dataset.rate;
        const usedHint = rate === "hint" || ui.round.revealed;
        answerReview(rate, usedHint, rate !== "bad");
      } else if (action === "review-next") nextReviewQuestion();
      else if (action === "export-progress") openProgressModal("export");
      else if (action === "import-progress") openProgressModal("import");
      else if (action === "copy-progress") copyProgress();
      else if (action === "apply-import") applyImport();
      else if (action === "open-reset") document.getElementById("resetModal").classList.add("show");
      else if (action === "confirm-reset") {
        state = defaultState(); saveState(); ui = { ...ui, view: "overview", pieceId: model.pieces[0].id, selectedVocabId: null, quiz: null, round: null }; document.getElementById("resetModal").classList.remove("show"); render(); showToast("学习进度已重置");
      } else if (action === "close-modal") target.closest(".modal").classList.remove("show");
      if (action !== "more" && !target.closest("#moreMenu")) moreMenu.hidden = true;
    });

    document.addEventListener("submit", event => {
      if (event.target.dataset.form === "quiz") {
        event.preventDefault(); answerQuiz(new FormData(event.target).get("answer"));
      } else if (event.target.dataset.form === "review") {
        event.preventDefault(); answerReview(new FormData(event.target).get("answer"), false);
      }
    });

    document.addEventListener("change", event => {
      const type = event.target.dataset.change;
      if (type === "piece") {
        ui.pieceId = event.target.value;
        state.pref.pieceId = ui.pieceId;
        ui.selectedVocabId = null;
        ui.quiz = null;
        ui.memorizeIndex = 0;
        saveState(); render();
      } else if (type === "highlights") { ui.highlights = event.target.checked; render(); }
      else if (type === "review-filter") { ui.reviewFilter = event.target.value; ui.round = null; render(); }
    });

    document.querySelectorAll(".tab-button").forEach(button => button.addEventListener("click", () => {
      ui.round = button.dataset.view === "review" ? ui.round : null;
      setView(button.dataset.view);
    }));

    document.querySelectorAll(".modal").forEach(modal => modal.addEventListener("click", event => {
      if (event.target === modal) modal.classList.remove("show");
    }));

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        moreMenu.hidden = true;
        closeNote();
        document.querySelectorAll(".modal.show").forEach(modal => modal.classList.remove("show"));
      }
    });
  }

  async function init() {
    bindEvents();
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`内容加载失败（${response.status}）`);
      rawData = await response.json();
      model = buildModel(rawData);
      state = loadState();
      ui.view = ["overview", "learn", "review", "full"].includes(state.pref.view) ? state.pref.view : "overview";
      ui.pieceId = model.pieceMap.has(state.pref.pieceId) ? state.pref.pieceId : model.pieces[0].id;
      render();
      if (window.ReviewSync) {
        window.ReviewSync.init({
          deckKey: "textbooks/pep/chinese/grade8a-required-recitations",
          app: APP_ID,
          title: "人教语文八上必背古诗文",
          getData: () => ({ status: state.items, pref: { pieces: state.pieces, ui: state.pref, roundCounter: state.roundCounter } }),
          applyData: applySyncData
        });
      }
    } catch (error) {
      app.innerHTML = `<div class="fatal-error"><strong>无法加载课文数据</strong><br>${escapeHtml(error.message)}<br>请通过项目的本地服务器或部署地址打开此页面。</div>`;
    }
  }

  init();
})();
