// 이 사이트는 Netlify 사이트 암호로 이미 보호된다. 함수 인증은 중복이라 두지 않는다.
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
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  if (!OWNER || !TOKEN) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'GITHUB_OWNER / GITHUB_TOKEN env var not set' }) };
  }
  try {
    if (event.httpMethod === 'GET') {
      const date = event.queryStringParameters && event.queryStringParameters.date;
      const { data } = await fetchLog();
      return { statusCode: 200, headers: cors, body: JSON.stringify(date ? (data[date] || {}) : data) };
    }
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { date, habit, close, habits } = body;
      if (!date) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'date required' }) };
      }

      // "오늘 마감" — 안 찍은 항목을 전부 false 로 확정한다.
      // 기록 없음(모름)과 안 함(false)이 구분되지 않으면 어떤 지표도 읽을 수 없다.
      if (close) {
        if (!Array.isArray(habits) || !habits.length) {
          return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'habits required when close' }) };
        }
        const { data, sha } = await fetchLog();
        if (!data[date]) data[date] = {};
        const filled = habits.filter((k) => data[date][k] === undefined);
        filled.forEach((k) => { data[date][k] = false; });
        if (filled.length) await saveLog(data, sha, `check-in: ${date} 마감 (${filled.join(',')}=false)`);
        return { statusCode: 200, headers: cors, body: JSON.stringify({ date, filled, log: data }) };
      }

      if (!habit) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'habit required' }) };
      }
      const { data, sha } = await fetchLog();
      if (!data[date]) data[date] = {};

      // value 를 주면 그대로 쓴다. null 은 기록 삭제(= 모름).
      // 안 주면 예전처럼 뒤집는다 — 옛 클라이언트가 깨지지 않게.
      if ('value' in body) {
        if (body.value === null) delete data[date][habit];
        else data[date][habit] = !!body.value;
      } else {
        data[date][habit] = !data[date][habit];
      }
      if (!Object.keys(data[date]).length) delete data[date];

      const shown = data[date] === undefined ? 'none' : String(data[date][habit]);
      await saveLog(data, sha, `check-in: ${date} ${habit}=${shown}`);
      // Return the whole log so the client can refresh stats without a second round trip.
      return { statusCode: 200, headers: cors, body: JSON.stringify({ date, habit, value: data[date] && data[date][habit], log: data }) };
    }
    return { statusCode: 405, headers: cors, body: 'Method not allowed' };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
  }
};
