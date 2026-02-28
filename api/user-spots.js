const { Redis } = require('@upstash/redis');
const path = require('path');
const fs = require('fs');

const REDIS_KEY = 'user-spots';

function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

// リポジトリに含まれる user-spots.json をフォールバックとして使用
function getStaticData() {
  try {
    const filePath = path.join(process.cwd(), 'public', 'user-spots.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

module.exports = async function handler(req, res) {
  const redis = getRedis();

  // GET — スポット一覧を返す
  if (req.method === 'GET') {
    try {
      if (redis) {
        const data = await redis.get(REDIS_KEY);
        if (data !== null) return res.json(Array.isArray(data) ? data : []);
      }
      // Redis未設定またはキーなし → 静的ファイルから返す
      return res.json(getStaticData());
    } catch (e) {
      console.error('user-spots GET error:', e.message);
      return res.json(getStaticData());
    }
  }

  // POST — スポット一覧を保存する
  if (req.method === 'POST') {
    const spots = req.body;
    if (!Array.isArray(spots)) return res.status(400).json({ error: 'Array expected' });

    if (!redis) {
      // Redis未設定時はエラーを返すが、フロントは続行できるようにする
      return res.status(503).json({ error: 'Redis未設定のため保存できません（ローカル環境では server.js を使用してください）' });
    }

    try {
      await redis.set(REDIS_KEY, spots);
      return res.json({ success: true });
    } catch (e) {
      console.error('user-spots POST error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
