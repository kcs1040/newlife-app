// 범용 JSON 저장소. GitHub 저장소의 파일 하나를 읽고 쓴다.
// 토큰은 Netlify 환경변수에만 존재하며 브라우저로 전달되지 않는다.

const crypto = require('crypto');

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const FILE = process.env.DATA_FILE || 'finance.json';

// 공유 암호. Netlify 사이트 보호를 끄더라도 이 함수만은 열리지 않게 한다.
// 미설정이면 검사하지 않으므로 기존 배포가 깨지지 않는다 — 설정하는 순간 켜진다.
const SECRET = process.env.APP_SECRET;
// CORS는 같은 사이트에서만 부르므로 굳이 열어둘 이유가 없다.
const ORIGIN = process.env.APP_ORIGIN || '';
// 화면에 쓰기 UI가 없다. 갱신은 Claude Code 세션에서 저장소에 직접 커밋한다.
// 그러니 쓰기 경로는 꺼두는 게 맞다 — 실수로든 악의로든 덮어쓸 창구를 없앤다.
const ALLOW_WRITE = process.env.ALLOW_WRITE === 'true';

function authorized(event) {
  if (!SECRET) return true;
  const h = event.headers || {};
  const given = h['x-app-key'] || h['X-App-Key'] || '';
  const a = Buffer.from(String(given));
  const b = Buffer.from(SECRET);
  // 길이가 다르면 timingSafeEqual이 던지므로 먼저 거른다
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const EMPTY = { items: [], accounts: [], updatedAt: null };

function ghHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'newlife-family',
  };
}

const url = () => `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;

async function read() {
  const res = await fetch(url(), { headers: ghHeaders() });
  if (res.status === 404) return { data: { ...EMPTY }, sha: null };
  if (!res.ok) throw new Error(`읽기 실패 (${res.status})`);
  const json = await res.json();
  const text = Buffer.from(json.content, 'base64').toString('utf-8');
  return { data: { ...EMPTY, ...JSON.parse(text) }, sha: json.sha };
}

async function write(data, sha, message) {
  data.updatedAt = new Date().toISOString();
  const body = {
    message,
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64'),
  };
  if (sha) body.sha = sha;
  const res = await fetch(url(), {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || `쓰기 실패 (${res.status})`);
  }
  return data;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Key',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!OWNER || !TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'GITHUB_OWNER / GITHUB_TOKEN 미설정' }) };
  }
  if (!authorized(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: '암호가 필요합니다' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const { data } = await read();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'POST') {
      if (!ALLOW_WRITE) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: '읽기 전용입니다' }) };
      }
      const { action, payload } = JSON.parse(event.body || '{}');
      const { data, sha } = await read();

      // 전체 목록을 통째로 교체한다. 클라이언트가 편집 결과를 그대로 보내는 방식이라
      // 항목별 API를 따로 만들 필요가 없고, 충돌은 sha로 잡힌다.
      if (action === 'replace') {
        if (!payload || typeof payload !== 'object') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'payload 필요' }) };
        }
        const next = { ...data };
        if (Array.isArray(payload.items)) next.items = payload.items;
        if (Array.isArray(payload.accounts)) next.accounts = payload.accounts;
        const saved = await write(next, sha, `finance: update (${new Date().toISOString().slice(0, 10)})`);
        return { statusCode: 200, headers, body: JSON.stringify(saved) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: `알 수 없는 action: ${action}` }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
