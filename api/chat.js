// Vercel Serverless Function ── ブラウザからAPIキーを隠すための中継
// ブラウザ → この関数 → Anthropic API の順で呼ぶ。キーはサーバー側だけが持つ。

// ざっくりレート制限（メモリ上・体験配布向けの簡易版）
// 1IPあたり 1時間で MAX_PER_HOUR 通まで。
const MAX_PER_HOUR = 30;
const MAX_INPUT_CHARS = 500;
const buckets = new Map(); // ip -> { count, resetAt }

function rateLimit(ip) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (b.count >= MAX_PER_HOUR) return false;
  b.count++;
  return true;
}

const SYSTEM_PROMPT = `あなたは秋田県鹿角市の観光コンシェルジェ「かづのナビ」です。道の駅かづの あんとらあ を拠点に、旅行者の質問へ親しみやすく的確に答えます。

# 拠点情報
道の駅かづの あんとらあ：鹿角観光の拠点。きりたんぽ発祥の地・鹿角の食と祭り文化が集まる基点。
営業：売店・レストラン・直売所 9:00〜18:00（12〜3月は〜17:00）
アクセス：東北道 鹿角八幡平ICから車で約5分／JR花輪線 鹿角花輪駅から徒歩約15分
館内施設：レストラン&ダイニングMITACHI、きりたんぽ館、そば屋、フルフルッタ（ジェラート）、かづのマルシェ直売所、秋田木楽舎（組木細工）、花輪ばやし祭り展示館、手づくり体験館（みそ付けたんぽ体験）

# 鹿角の主な見どころ
- 大湯環状列石（世界遺産・縄文ストーンサークル、車で約15分）
- 花輪ばやし（8月、日本三大ばやし、ユネスコ無形文化遺産）／祭り展示館は通年見学可
- 毛馬内の盆踊り（8月、国重要無形民俗文化財）
- 湯瀬温泉・大湯温泉（車で約20分）
- きりたんぽ発祥の地。みそ付けたんぽ体験が人気
- 秋は紅葉（八幡平・十和田湖方面）、かづの北限の桃も名産

# 応答ルール
- 回答は簡潔に、まず結論。3〜5文程度を目安に。
- 道の駅あんとらあを起点にした動線で案内する。
- 移動時間や営業時間など具体情報を添える。
- クーポン対象店（きりたんぽ館・MITACHI・温泉宿・祭り展示館など）が話題に出たら、最後に「👉 クーポンは画面下の『クーポン』から受け取れます」と一言添える。
- 分からないことは正直に伝え、あんとらあ館内スタッフへの確認を促す。
- 敬語で、フレンドリーに。`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (!rateLimit(ip)) {
    return res.status(429).json({ error: "しばらく時間をおいてからお試しください（利用が集中しています）。" });
  }

  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages required" });
    }
    // 入力文字数の上限チェック（最後のユーザー発言）
    const last = messages[messages.length - 1];
    if (last?.content && last.content.length > MAX_INPUT_CHARS) {
      return res.status(400).json({ error: `入力は${MAX_INPUT_CHARS}文字以内でお願いします。` });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: "AI応答の取得に失敗しました。", detail: data });
    }
    const reply = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: "サーバーエラーが発生しました。" });
  }
}
