// ─── アプリ状態 ───────────────────────────────────────────────────────────────
const state = {
  currentQuestion: 0,
  questions: [],
  answers: [],
  locationName: '',
  transport: 'walking',
  coords: null,
};

const TRANSPORT_LABEL = { walking: '徒歩', bicycle: '自転車', train: '電車' };

// ─── Gemini API ───────────────────────────────────────────────────────────────
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function fetchQuestions(locationName, transport) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_API_KEY_HERE') {
    throw new Error('config.js に Gemini API キーを設定してください。');
  }

  const transportLabel = TRANSPORT_LABEL[transport];
  const prompt = `あなたはお散歩スポット提案AIです。
ユーザーの出発地と交通手段をもとに、お散歩の好みを引き出す質問を3つ生成してください。

【ユーザー情報】
- 出発地: ${locationName}
- 交通手段: ${transportLabel}

【出力ルール】
- 質問はお散歩の目的・気分・雰囲気・好みを聞くもので、毎回少し違う切り口にしてください
- 各質問の選択肢は必ず3つ、絵文字つきで短く具体的にしてください
- 日本語で出力してください

以下のJSON形式のみで回答してください（コードブロック不要）:
{
  "questions": [
    { "text": "質問文？", "choices": ["😊 選択肢A", "🌿 選択肢B", "🎨 選択肢C"] },
    { "text": "質問文？", "choices": ["選択肢A", "選択肢B", "選択肢C"] },
    { "text": "質問文？", "choices": ["選択肢A", "選択肢B", "選択肢C"] }
  ]
}`;

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const result = JSON.parse(clean);
  return result.questions ?? [];
}

function buildPrompt(answers, locationName, transport) {
  const transportLabel = TRANSPORT_LABEL[transport];
  return `あなたはお散歩スポット提案AIです。
ユーザーの情報をもとに、実在する観光スポット・公園・飲食エリアなどを提案してください。

【ユーザー情報】
- 出発地: ${locationName}
- 交通手段: ${transportLabel}
- 気分: ${answers[0]}
- 雰囲気: ${answers[1]}
- 目的: ${answers[2]}

【出力ルール】
- nearには出発地から${transportLabel}で30分以内のスポットを2〜3件
- mediumには30分超〜60分以内のスポットを2〜3件
- travelMinutesは${transportLabel}での所要時間（整数、分）
- reasonはユーザーの気分・雰囲気・目的と絡めた推薦理由（100字以内）
- 住所は都道府県から記載

以下のJSON形式のみで回答してください（コードブロック不要）:
{
  "near": [
    {
      "name": "スポット名",
      "address": "住所",
      "reason": "おすすめ理由",
      "travelMinutes": 所要時間
    }
  ],
  "medium": [
    {
      "name": "スポット名",
      "address": "住所",
      "reason": "おすすめ理由",
      "travelMinutes": 所要時間
    }
  ]
}`;
}

async function callLLM(answers, locationName, transport) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_API_KEY_HERE') {
    throw new Error('config.js に Gemini API キーを設定してください。');
  }

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(answers, locationName, transport) }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // responseMimeType: application/json でも稀にコードブロックが付くため除去
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const result = JSON.parse(clean);

  return {
    near:   (result.near   ?? []),
    medium: (result.medium ?? []),
  };
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function formatTime(mins) {
  if (mins < 60) return `約${mins}分`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `約${h}時間` : `約${h}時間${m}分`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const chatContainer    = document.getElementById('chat-container');
const setupArea        = document.getElementById('setup-area');
const choicesArea      = document.getElementById('choices-area');
const choicesContainer = document.getElementById('choices-container');
const loadingArea      = document.getElementById('loading-area');

function scrollToBottom() {
  chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
}

// ─── メッセージ追加 ───────────────────────────────────────────────────────────
function addBotMessage(html) {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex items-start gap-2.5 fade-in';
  wrapper.innerHTML = `
    <div class="w-9 h-9 bg-gradient-to-br from-green-400 to-emerald-600 rounded-full flex items-center justify-center text-lg flex-shrink-0 shadow-sm">🌿</div>
    <div class="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm max-w-[78%] text-sm text-gray-800 leading-relaxed border border-gray-100">
      ${html}
    </div>
  `;
  chatContainer.appendChild(wrapper);
  scrollToBottom();
}

function addUserMessage(text) {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex items-start gap-2.5 justify-end fade-in';
  wrapper.innerHTML = `
    <div class="bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm max-w-[78%] text-sm text-white leading-relaxed">
      ${escapeHtml(text)}
    </div>
    <div class="w-9 h-9 bg-gray-200 rounded-full flex items-center justify-center text-lg flex-shrink-0 shadow-sm">😊</div>
  `;
  chatContainer.appendChild(wrapper);
  scrollToBottom();
}

// ─── タイピングインジケーター ─────────────────────────────────────────────────
function showTyping() {
  const el = document.createElement('div');
  el.id = 'typing-indicator';
  el.className = 'flex items-start gap-2.5 fade-in';
  el.innerHTML = `
    <div class="w-9 h-9 bg-gradient-to-br from-green-400 to-emerald-600 rounded-full flex items-center justify-center text-lg flex-shrink-0 shadow-sm">🌿</div>
    <div class="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm border border-gray-100 flex gap-1.5 items-center">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>
  `;
  chatContainer.appendChild(el);
  scrollToBottom();
}

function removeTyping() {
  document.getElementById('typing-indicator')?.remove();
}

// ─── 質問フェーズの選択肢 ─────────────────────────────────────────────────────
function showChoices(choices) {
  choicesContainer.innerHTML = '';
  choices.forEach(choice => {
    const btn = document.createElement('button');
    btn.className = [
      'w-full py-3 px-4 rounded-xl border-2 border-gray-200 text-gray-700 text-sm font-medium text-left',
      'hover:border-green-400 hover:bg-green-50 hover:text-green-700 active:scale-[0.98] transition-all',
    ].join(' ');
    btn.textContent = choice;
    btn.addEventListener('click', () => handleAnswer(choice));
    choicesContainer.appendChild(btn);
  });
  choicesArea.classList.remove('hidden');
}

function hideChoices() {
  choicesArea.classList.add('hidden');
  choicesContainer.innerHTML = '';
}

// ─── スポットカード（Gemini が返す travelMinutes を直接使用） ─────────────────
function renderSpotCard(spot) {
  const time    = formatTime(spot.travelMinutes);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.name + ' ' + spot.address)}`;
  return `
    <div class="space-y-1.5">
      <p class="font-bold text-gray-900">${escapeHtml(spot.name)}</p>
      <p class="text-gray-500 text-xs leading-relaxed">${escapeHtml(spot.reason)}</p>
      <div class="flex flex-wrap items-center gap-2 pt-0.5">
        <span class="inline-flex items-center bg-green-50 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-green-200">
          ${TRANSPORT_LABEL[state.transport]}で${time}
        </span>
        <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer"
           class="text-blue-500 hover:text-blue-700 text-xs font-semibold underline">
          📍 地図を見る
        </a>
      </div>
    </div>
  `;
}

// ─── 回答ハンドラ ─────────────────────────────────────────────────────────────
async function handleAnswer(answer) {
  state.answers.push(answer);
  hideChoices();
  addUserMessage(answer);
  state.currentQuestion++;

  if (state.currentQuestion < state.questions.length) {
    await delay(600);
    showTyping();
    await delay(900);
    removeTyping();
    addBotMessage(state.questions[state.currentQuestion].text);
    showChoices(state.questions[state.currentQuestion].choices);
  } else {
    await showResult();
  }
}

// ─── 結果表示（30分以内を先出し） ────────────────────────────────────────────
async function showResult() {
  await delay(600);
  showTyping();
  loadingArea.classList.remove('hidden');

  let result;
  try {
    result = await callLLM(state.answers, state.locationName, state.transport);
  } catch (err) {
    removeTyping();
    loadingArea.classList.add('hidden');
    addBotMessage(`⚠️ エラーが発生しました。<br><span class="text-xs text-gray-500">${escapeHtml(err.message)}</span>`);
    showRestartButton();
    return;
  }

  removeTyping();
  loadingArea.classList.add('hidden');

  const { near, medium } = result;

  if (near.length > 0) {
    addBotMessage(
      `${TRANSPORT_LABEL[state.transport]}で <strong>30分以内</strong> に行けるスポットを ${near.length} 件見つけました！ 🎯`
    );
    for (const spot of near) {
      await delay(400);
      addBotMessage(renderSpotCard(spot));
    }
  } else {
    addBotMessage(`${TRANSPORT_LABEL[state.transport]}で30分以内のスポットは見つかりませんでした。`);
  }

  if (medium.length > 0) {
    await delay(700);
    addBotMessage(
      `他に <strong>30〜60分</strong> 圏内のスポットも ${medium.length} 件あります。さらに表示しますか？`
    );
    showYesNoChoice(medium);
  } else {
    await delay(500);
    addBotMessage('よいお散歩を！ 🌿');
    showRestartButton();
  }
}

// ─── はい/いいえ ───────────────────────────────────────────────────────────────
function showYesNoChoice(mediumSpots) {
  choicesContainer.innerHTML = '';

  const base = 'w-full py-3 px-4 rounded-xl border-2 text-sm font-semibold text-left active:scale-[0.98] transition-all';

  const yesBtn = document.createElement('button');
  yesBtn.className = `${base} border-green-400 bg-green-50 text-green-700 hover:bg-green-100`;
  yesBtn.textContent = '✅ はい、もっと見たい';
  yesBtn.addEventListener('click', () => handleYes(mediumSpots));

  const noBtn = document.createElement('button');
  noBtn.className = `${base} border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50`;
  noBtn.textContent = '🙅 いいえ、これで十分です';
  noBtn.addEventListener('click', handleNo);

  choicesContainer.appendChild(yesBtn);
  choicesContainer.appendChild(noBtn);
  choicesArea.classList.remove('hidden');
}

async function handleYes(mediumSpots) {
  hideChoices();
  addUserMessage('はい、もっと見たい');
  await delay(400);
  addBotMessage(`${TRANSPORT_LABEL[state.transport]}で <strong>30〜60分</strong> 圏内のスポットはこちらです！`);
  for (const spot of mediumSpots) {
    await delay(400);
    addBotMessage(renderSpotCard(spot));
  }
  await delay(600);
  addBotMessage('以上です！お気に入りのスポットは見つかりましたか？ 🌟');
  showRestartButton();
}

async function handleNo() {
  hideChoices();
  addUserMessage('いいえ、これで十分です');
  await delay(400);
  addBotMessage('わかりました！素敵なお散歩を楽しんできてください 🌿');
  showRestartButton();
}

// ─── もう一度ボタン ───────────────────────────────────────────────────────────
function showRestartButton() {
  choicesContainer.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = [
    'w-full py-3 rounded-xl border-2 border-green-400 text-green-700 bg-green-50 text-sm font-bold',
    'hover:bg-green-100 active:scale-[0.98] transition-all',
  ].join(' ');
  btn.textContent = '🔄 もう一度探す';
  btn.addEventListener('click', resetApp);
  choicesContainer.appendChild(btn);
  choicesArea.classList.remove('hidden');
}

// ─── チャット開始 ─────────────────────────────────────────────────────────────
async function startChat() {
  setupArea.classList.add('hidden');

  await delay(300);
  addBotMessage(`
    こんにちは！おさんぽAIです 🌿<br>
    <span class="text-gray-500 text-xs mt-1 block">出発地: <strong class="text-gray-700">${escapeHtml(state.locationName)}</strong>　交通手段: <strong class="text-gray-700">${TRANSPORT_LABEL[state.transport]}</strong></span>
    <br>
    あなたにぴったりの質問を考えています...
  `);

  showTyping();
  document.getElementById('loading-text').textContent = '質問を考えています...';
  loadingArea.classList.remove('hidden');

  try {
    state.questions = await fetchQuestions(state.locationName, state.transport);
  } catch (err) {
    removeTyping();
    loadingArea.classList.add('hidden');
    addBotMessage(`⚠️ 質問の取得に失敗しました。<br><span class="text-xs text-gray-500">${escapeHtml(err.message)}</span>`);
    setupArea.classList.remove('hidden');
    return;
  }

  removeTyping();
  loadingArea.classList.add('hidden');
  document.getElementById('loading-text').textContent = 'おすすめスポットを探しています...';

  addBotMessage('3つの質問に答えるだけで、ぴったりのスポットを提案します！');
  await delay(400);
  addBotMessage(state.questions[0].text);
  showChoices(state.questions[0].choices);
}

// ─── リセット ─────────────────────────────────────────────────────────────────
function resetApp() {
  state.currentQuestion = 0;
  state.questions = [];
  state.answers = [];

  chatContainer.innerHTML = '';
  hideChoices();
  loadingArea.classList.add('hidden');
  setupArea.classList.remove('hidden');
}

// ─── セットアップUI ───────────────────────────────────────────────────────────
function applyTransportStyles() {
  document.querySelectorAll('.transport-btn').forEach(btn => {
    if (btn.dataset.mode === state.transport) {
      btn.className = 'transport-btn flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all border-green-500 bg-green-50 text-green-700';
    } else {
      btn.className = 'transport-btn flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all border-gray-200 text-gray-500 hover:border-gray-300';
    }
  });
}

document.querySelectorAll('.transport-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.transport = btn.dataset.mode;
    applyTransportStyles();
  });
});

applyTransportStyles();

document.getElementById('geo-btn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('お使いのブラウザは位置情報に対応していません。');
    return;
  }
  const btn = document.getElementById('geo-btn');
  const locationInput = document.getElementById('location-input');
  btn.textContent = '取得中...';
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    async position => {
      const { latitude: lat, longitude: lng } = position.coords;
      state.coords = { lat, lng };

      btn.textContent = '住所変換中...';
      locationInput.value = '';
      locationInput.placeholder = '住所を取得しています...';

      try {
        // zoom=18 で丁目レベルの詳細を要求
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}&accept-language=ja`,
          { headers: { 'Accept-Language': 'ja', 'User-Agent': 'osanpoAI/1.0' } }
        );
        const data = await res.json();
        const a = data.address ?? {};

        // 都道府県・市区町村を確定
        const prefecture = a.state ?? '';
        const city = a.city || a.city_district || a.county || a.town || a.village || '';

        // 町丁目候補を複数取得し、包含関係で重複除去（より具体的な方を残す）
        const districtCandidates = [a.quarter, a.suburb, a.neighbourhood]
          .filter(Boolean)
          .reduce((acc, val) => {
            // 既存の値に含まれている、または既存の値を含む場合は長い方を残す
            const dominated = acc.findIndex(v => v.includes(val) || val.includes(v));
            if (dominated === -1) {
              acc.push(val);
            } else if (val.length > acc[dominated].length) {
              acc[dominated] = val;
            }
            return acc;
          }, []);

        const parts = [prefecture, city, ...districtCandidates].filter(Boolean);
        state.locationName = parts.length >= 2
          ? parts.join('')
          : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      } catch {
        // リバースジオコーディング失敗時は高精度な座標を渡す
        state.locationName = `緯度${lat.toFixed(5)} 経度${lng.toFixed(5)}`;
      }

      locationInput.value = state.locationName;
      locationInput.placeholder = '例: 渋谷駅、自宅など...';
      btn.textContent = '📡 現在地';
      btn.disabled = false;
    },
    () => {
      alert('位置情報の取得に失敗しました。手動で入力してください。');
      btn.textContent = '📡 現在地';
      btn.disabled = false;
    },
    { enableHighAccuracy: true }
  );
});

document.getElementById('start-btn').addEventListener('click', () => {
  const input = document.getElementById('location-input').value.trim();
  if (!input) {
    const locationInput = document.getElementById('location-input');
    locationInput.focus();
    locationInput.classList.add('ring-2', 'ring-red-300', 'border-red-300');
    setTimeout(() => locationInput.classList.remove('ring-2', 'ring-red-300', 'border-red-300'), 2000);
    return;
  }
  state.locationName = input;
  startChat();
});
