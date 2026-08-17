const crypto = require('crypto');

// 공유 암호. 미설정이면 검사하지 않는다 — APP_SECRET을 넣는 순간 켜진다.
const SECRET = process.env.APP_SECRET;
function authorized(event) {
  if (!SECRET) return true;
  const h = event.headers || {};
  const a = Buffer.from(String(h['x-app-key'] || h['X-App-Key'] || ''));
  const b = Buffer.from(SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO || 'newlife-checkin';
const TOKEN = process.env.GITHUB_TOKEN;
const FILE_PATH = 'log.json';

function apiUrl() {
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;
}

function ghHeaders() {
  return {
    'Authorization': `Bearer ${TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'newlife-checkin-app'
  };
}

async function fetchLog() {
  const res = await fetch(apiUrl(), { headers: ghHeaders() });
  if (res.status === 404) return { data: {}, sha: null };
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const json = await res.json();
  const data = JSON.parse(Buffer.from(json.content, 'base64').toString('utf-8'));
  return { data, sha: json.sha };
}

async function saveLog(data, sha, message) {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64')
  };
  if (sha) body.sha = sha;
  const res = await fetch(apiUrl(), {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub write failed: ${res.status}`);
  }
  return res.json();
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Key'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  if (!OWNER || !TOKEN) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'GITHUB_OWNER / GITHUB_TOKEN env var not set' }) };
  }
  if (!authorized(event)) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: '암호가 필요합니다' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const date = event.queryStringParameters && event.queryStringParameters.date;
      const { data } = await fetchLog();
      return { statusCode: 200, headers: cors, body: JSON.stringify(date ? (data[date] || {}) : data) };
    }
    if (event.httpMethod === 'POST') {
      const { date, habit } = JSON.parse(event.body || '{}');
      if (!date || !habit) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'date, habit required' }) };
      }
      const { data, sha } = await fetchLog();
      if (!data[date]) data[date] = {};
      data[date][habit] = !data[date][habit];
      await saveLog(data, sha, `check-in: ${date} ${habit}=${data[date][habit]}`);
      // Return the whole log so the client can refresh stats without a second round trip.
      return { statusCode: 200, headers: cors, body: JSON.stringify({ date, habit, value: data[date][habit], log: data }) };
    }
    return { statusCode: 405, headers: cors, body: 'Method not allowed' };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
