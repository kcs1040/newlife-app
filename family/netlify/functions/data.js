// 범용 JSON 저장소. GitHub 저장소의 파일 하나를 읽고 쓴다.
// 토큰은 Netlify 환경변수에만 존재하며 브라우저로 전달되지 않는다.

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;
const FILE = process.env.DATA_FILE || 'finance.json';

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
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!OWNER || !TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'GITHUB_OWNER / GITHUB_TOKEN 미설정' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const { data } = await read();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'POST') {
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
