const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-5-20250929';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `あなたはランニング×パン屋検索アプリのアシスタントです。
ユーザーの自然言語入力から以下の情報を抽出し、JSON形式で返してください。

抽出する項目:
- origin: 始点（ランニングの出発地点）
- destination: 目的地（ランニングのゴール地点）
- departureTime: 出発時刻（HH:MM形式、24時間制）
- duration: 所要時間（分単位の数値）
- breadType: パンの種別（"soft" = ソフト/菓子パン系、"hard" = ハード/本格パン系）
- dayOfWeek: 走る曜日（"mo"/"tu"/"we"/"th"/"fr"/"sa"/"su"）

情報が明示されていない項目はnullにしてください。
JSONのみを返し、説明は不要です。

ユーザー入力: ${text}`
      }],
    });

    const content = message.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'AI応答からJSONを抽出できませんでした' });
    }
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error('Parse API error:', err.message);
    res.status(500).json({ error: 'AI解析に失敗しました: ' + err.message });
  }
};
