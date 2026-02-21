const Anthropic = require('@anthropic-ai/sdk');
const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const client = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-5-20250929';
const RECOMMEND_TTL = 30 * 60; // 30分（秒単位）

// Upstash Redis クライアント（環境変数が未設定の場合はnull）
function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { bakeries, origin, destination, breadType, dayOfWeek } = req.body;
  if (!bakeries || !bakeries.length) {
    return res.status(400).json({ error: 'bakeries list is required' });
  }

  const cacheRaw = JSON.stringify({ bakeries, origin, destination, breadType, dayOfWeek });
  const cacheKey = 'recommend:' + crypto.createHash('sha256').update(cacheRaw).digest('hex');
  const redis = getRedis();

  // キャッシュチェック
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log('[recommend] cache hit');
        return res.json(cached);
      }
    } catch (e) {
      console.warn('[recommend] cache read error:', e.message);
    }
  }

  const bakeryList = bakeries.map((b, i) =>
    `${i + 1}. ${b.name}（経路から${b.dist}m、${b.hours || '営業時間不明'}、${b.address || '住所不明'}）`
  ).join('\n');

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `あなたはランナー向けスポットおすすめアドバイザーです。

以下のランニングコースと検索結果のパン屋リストを分析し、ランナーにおすすめのパン屋を最大3店選んでください。
※ランニングステーションや銭湯も経路上に表示されますが、おすすめ対象はパン屋のみです。

コース: ${origin || '不明'} → ${destination || '不明'}
走る曜日: ${({'mo':'月曜日','tu':'火曜日','we':'水曜日','th':'木曜日','fr':'金曜日','sa':'土曜日','su':'日曜日'})[dayOfWeek] || '不明'}
パン種別: ${breadType === 'soft' ? 'ソフト（菓子パン系）' : 'ハード（本格パン系）'}

パン屋リスト:
${bakeryList}

以下のJSON形式で返してください。説明テキストは不要です:
{
  "recommendations": [
    {
      "index": 1,
      "name": "店名",
      "reason": "おすすめ理由（ランナー視点で1-2文）"
    }
  ]
}

選定基準:
- 経路からの距離が近い（寄り道が少ない）
- 走る曜日に営業している店を優先
- 営業時間が明記されている店を優先
- 店名や種別からパンの質が期待できる
- ランニング後の補給に適している`
      }],
    });

    const content = message.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'AI応答からJSONを抽出できませんでした' });
    }
    const parsed = JSON.parse(jsonMatch[0]);

    // キャッシュに保存
    if (redis) {
      try {
        await redis.set(cacheKey, parsed, { ex: RECOMMEND_TTL });
      } catch (e) {
        console.warn('[recommend] cache write error:', e.message);
      }
    }

    res.json(parsed);
  } catch (err) {
    console.error('Recommend API error:', err.message);
    res.status(500).json({ error: 'AIおすすめ生成に失敗しました: ' + err.message });
  }
};
