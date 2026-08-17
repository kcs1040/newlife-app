# newlife-app

New Life 프로젝트의 웹 앱 소스. Netlify가 이 저장소를 감시해 push 시 자동 배포한다.

| 디렉토리 | 사이트 | 공유 |
|---|---|---|
| `personal/` | csknl.netlify.app | 본인만 — 체크인·대시보드·투자·지식 |
| `family/` | (예정) | 와이프와 공유 — 가계 재정·육아 |

**데이터는 여기 없다.** 별도 저장소 `newlife-checkin`의 JSON 파일에 저장된다.
코드와 데이터를 나눈 이유: 같은 저장소면 체크인할 때마다 사이트가 재배포된다.

## Netlify 환경변수 (사이트별 설정)
- `GITHUB_OWNER` — kcs1040
- `GITHUB_REPO` — newlife-checkin
- `GITHUB_TOKEN` — fine-grained PAT (Contents: Read and write), **secret으로 표시**
