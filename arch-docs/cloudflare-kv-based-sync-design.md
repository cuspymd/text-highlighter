# Cloudflare KV 기반 클라우드 동기화 설계안

## 배경 및 목표

text-highlighter는 현재 `storage.sync` API로 하이라이트와 설정을 동기화한다(`arch-docs/sync-requirements.md`, `background/sync-service.js`). 그러나 **Firefox Android는 `storage.sync`를 지원하지 않아** 해당 플랫폼에서는 기기 간 동기화가 불가능하다.

이 문서는 브라우저 자체 sync에 의존하지 않고, **Cloudflare 무료 티어만으로** 별도의 클라우드 동기화를 제공하는 방안을 정리한다. 핵심 제약은 다음과 같다.

- Cloudflare **무료 티어**만 사용 (유료 플랜/애드온 없음)
- 서버는 암호문만 저장 — **클라이언트 사이드 종단간 암호화(E2EE)**로 개인정보 보호
- 사용자 수가 적은 무료 확장 프로그램이라는 전제하에, **구현 복잡도를 최소화**하는 방향을 우선 (계정 시스템·서버측 인증·rate limiting 등은 1차 범위에서 제외)

관련 논의 경과:
- Cloudflare KV(무료 쓰기 1,000/일)는 "하이라이트 변경마다 push"하는 현재 패턴엔 부적합하다고 판단했으나, **URL별 개별 동기화 대신 전체 데이터를 하나의 블롭으로 묶어 배치 동기화**하면 쓰기 횟수가 크게 줄어 KV로도 충분하다는 결론에 도달함
- 확장 프로그램은 "비밀을 가질 수 없는 클라이언트"이므로 별도 API 키로 확장 프로그램 자체를 인증하려 하지 않음. 대신 사용자별 **동기화 코드에서 파생한 고유 키(`keyId`)** 를 리소스 접근 토큰으로 사용
- 어뷰징 방어(rate limiting 등)는 **1차 구현에서 생략**하고, 실제 문제가 발생하면 그때 대응하기로 함

---

## 1) 왜 KV인가

| 서비스 | 무료 티어 제한 | 비고 |
|---|---|---|
| **Workers KV** | 읽기 100k/일, 쓰기 1,000/일(네임스페이스 전체), 값 크기 25MB, 저장 1GB | 유저당 **블롭 1개**로 배치 동기화하면 쓰기 횟수가 적어 채택 가능 |
| D1 | 읽기 500만 row/일, 쓰기 10만 row/일, 5GB | 스키마/쿼리 설계 필요, 이번 범위엔 과함 |
| R2 | 저장 10GB, Class A(쓰기) 100만/월, Class B(읽기) 1000만/월 | 쿼리 기능 없음, KV와 목적이 겹침 |
| Durable Objects | 무료 플랜 미지원 | 제외 |

→ **Workers + KV**, 유저당 KV 항목 1개(`blob:<keyId>`)로 결정. 값 크기 제한(25MB)이 커서 기존 `storage.sync`의 8KB/아이템·90KB 총량 제약과 그로 인한 eviction/예산 로직이 통째로 불필요해진다.

---

## 2) 전체 아키텍처

```
[기기 A]  content/background  ──┐
                                 ├─ fetch(GET/PUT) ─→ [Cloudflare Worker] ─→ [KV Namespace]
[기기 B]  content/background  ──┘                         (blob:<keyId>)
```

- Worker는 인증 헤더 없이 `GET /blob/:keyId`, `PUT /blob/:keyId`만 제공하는 얇은 프록시
- 서버는 항상 **암호문**만 다루며 평문 하이라이트나 encryptionKey를 알 수 없음
- 기기 간 실시간 push는 없음 — pull-merge-push 방식의 주기적/수동 동기화

---

## 3) 동기화 코드(Sync Code) 설계

### 3.1 생성

```js
function generateSyncCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32)); // 256bit
  return encodeCrockfordBase32Grouped(bytes); // 예: "K7QZ-9X2M-P4R8-7H3D-..."
}
```

- 최초로 클라우드 동기화를 켤 때 1회 생성
- Crockford Base32 + 4자리 그룹 표기로 오타 발생 가능성이 높은 문자(0/O, 1/I) 제외
- 코드는 사용자에게 표시 + 복사 버튼 제공. **"저장하지 않으면 복구 불가"**를 온보딩 화면에 명시

### 3.2 키 파생 (HKDF)

패스워드가 아닌 완전 난수이므로 PBKDF2 같은 stretching 없이 HKDF만으로 충분하다.

```js
async function deriveSyncKeys(syncCode) {
  const codeBytes = decodeCrockfordBase32(syncCode);
  const baseKey = await crypto.subtle.importKey(
    'raw', codeBytes, 'HKDF', false, ['deriveKey', 'deriveBits']
  );

  const encryptionKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8('th-sync-encrypt-v1') },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  const keyIdBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8('th-sync-keyid-v1') },
    baseKey,
    128
  );

  return { encryptionKey, keyId: toHex(keyIdBits) };
}
```

- `info` 문자열만 다르게 주어 하나의 코드에서 서로 다른 두 값을 결정적으로 파생 (동일 코드 입력 시 모든 기기가 같은 값 도출)
- `encryptionKey`는 `extractable: false`로 생성해 메모리 덤프 외에는 추출 불가
- `keyId`는 128bit(hex 32자)로 충분한 엔트로피 확보

### 3.3 다기기 페어링

1. 기기 A: 코드 생성 → 로컬 저장(`browser.storage.local`) → 최초 업로드
2. 기기 B: 옵션 화면에서 코드 입력 → 동일 연산으로 동일 `keyId`/`encryptionKey` 도출(서버 통신 없이 로컬 계산) → pull-merge-push 1회 수행

### 3.4 코드 분실/변경

- 분실 시 복구 불가 — 새 코드로 새로 시작
- 로테이션 시 새 `keyId`로 현재 병합 데이터를 재업로드하고, 기존 `keyId` 데이터는 그대로 두거나(TTL로 자연 소멸) 사용자가 명시적으로 `DELETE`

---

## 4) 데이터 모델 (블롭 구조)

기존 로컬 스키마(URL별 하이라이트 + `_meta`)와 `SYNC_KEYS.SETTINGS` 페이로드를 하나의 JSON으로 통합한다.

```json
{
  "version": 1,
  "updatedAt": 1735800000000,
  "settings": {
    "customColors": [],
    "minimapVisible": true,
    "selectionControlsVisible": true,
    "shortcutColorMap": null
  },
  "pages": {
    "<url>": {
      "title": "...",
      "lastUpdated": "...",
      "highlights": [ { "groupId": "...", "color": "...", "ranges": [...], "updatedAt": 0 } ],
      "deletedGroupIds": { "<groupId>": 0 }
    }
  },
  "deletedUrls": { "<url>": 1735800000000 }
}
```

- `pages`, `deletedUrls`는 기존 `sync_meta.pages`/`deletedUrls`와 동일한 역할이지만 URL별 예산 관리가 필요 없으므로 리스트가 아닌 단순 맵으로 단순화
- 페이지 단위 병합은 기존 `mergeHighlights(localData, remoteData)`를 **URL별로 순회하며 그대로 재사용**
- 설정은 기존과 동일하게 last-write-wins(`updatedAt` 비교)

KV에는 이 JSON을 그대로 두지 않고, 암호화한 봉투(envelope)를 저장한다.

```json
{
  "v": 1,
  "iv": "<base64, 12bytes>",
  "ciphertext": "<base64>"
}
```

---

## 5) 암호화

- 알고리즘: **AES-GCM 256**
- 매 저장 시 새 IV(96bit) 생성 — 같은 키로 IV 재사용 금지
- 인증 태그는 GCM 특성상 ciphertext에 포함되므로 별도 저장 불필요

```js
async function encryptBlob(blobObj, encryptionKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = utf8(JSON.stringify(blobObj));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, plaintext);
  return { v: 1, iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

async function decryptBlob(envelope, encryptionKey) {
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encryptionKey, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}
```

---

## 6) Cloudflare Worker API

| 메서드 | 경로 | 동작 |
|---|---|---|
| GET | `/blob/:keyId` | KV에서 envelope 조회, 없으면 404 |
| PUT | `/blob/:keyId` | body(envelope)를 KV에 저장. 크기 상한 초과 시 413 |
| DELETE | `/blob/:keyId` | 사용자가 명시적으로 클라우드 데이터 삭제 요청 시 |

```js
// worker/src/index.js (요약)
const MAX_BODY_BYTES = 1_000_000; // 1MB 상한(안전장치, 어뷰징 방어 아님)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/blob\/([a-f0-9]{32})$/);
    if (!match) return new Response('Not Found', { status: 404 });
    const keyId = match[1];
    const kvKey = `blob:${keyId}`;

    if (request.method === 'GET') {
      const value = await env.SYNC_KV.get(kvKey);
      return value
        ? new Response(value, { headers: { 'Content-Type': 'application/json' } })
        : new Response('Not Found', { status: 404 });
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
        return new Response('Payload Too Large', { status: 413 });
      }
      await env.SYNC_KV.put(kvKey, body);
      return new Response(null, { status: 204 });
    }

    if (request.method === 'DELETE') {
      await env.SYNC_KV.delete(kvKey);
      return new Response(null, { status: 204 });
    }

    return new Response('Method Not Allowed', { status: 405 });
  },
};
```

```toml
# worker/wrangler.toml (요약)
name = "text-highlighter-sync"
main = "src/index.js"
compatibility_date = "2025-01-01"

kv_namespaces = [
  { binding = "SYNC_KV", id = "<production-kv-namespace-id>" }
]
```

- Worker ↔ KV는 `wrangler.toml`의 바인딩으로 연결되며 별도 API 키 불필요
- 배포용 Cloudflare 계정 API 토큰은 CI/개발자 로컬에만 존재, 확장 프로그램 코드에는 포함되지 않음

---

## 7) 클라이언트 동기화 흐름

```
1. GET  /blob/:keyId         → envelope (없으면 최초 업로드로 처리)
2. decryptBlob(envelope)     → remoteBlob
3. buildLocalBlob()          → localBlob (storage.local 전체를 4)의 스키마로 변환)
4. URL 합집합에 대해 mergeHighlights(local, remote) 반복 적용 + 설정 last-write-wins 병합
5. 병합 결과를 storage.local에 반영 + 열린 탭 브로드캐스트
6. encryptBlob(merged)       → envelope
7. PUT /blob/:keyId          → 서버 반영
```

### 트리거 시점

- 확장 프로그램/브라우저 시작 시 1회
- `browser.alarms`로 주기적 실행 (예: 15분 간격)
- 옵션/팝업의 "지금 동기화" 수동 버튼
- 하이라이트 변경 자체는 기존과 동일하게 로컬에 즉시 저장하고, 클라우드 push는 위 트리거 시점에만 배치로 수행(디바운스) — 이 배치 방식 덕분에 KV 쓰기 1,000/일 한도 안에서 여유 있게 동작

---

## 8) 코드 구조 제안

| 파일 | 역할 |
|---|---|
| `shared/crypto-utils.js` | `generateSyncCode`, `deriveSyncKeys`, `encryptBlob`, `decryptBlob` |
| `background/cloud-sync-service.js` | pull-merge-push 흐름, alarm 등록, `sync-service.js`의 `mergeHighlights` 재사용 |
| `constants/storage-keys.js` | `CLOUD_SYNC_ENABLED`, `CLOUD_SYNC_CODE`, `CLOUD_SYNC_LAST_SYNCED_AT` 등 키 추가 |
| `options.html`/`options.js` (신규 또는 기존 팝업 확장) | 코드 생성/표시/입력 UI, 동기화 상태 표시 |
| `worker/` (신규 디렉토리, 별도 배포 단위) | Worker 소스 + `wrangler.toml` |
| `manifest.json`, `manifest-firefox.json` | Worker 도메인에 대한 `host_permissions` 추가 |

`background/sync-service.js`(브라우저 `storage.sync`)는 그대로 유지하고, `cloud-sync-service.js`는 별도 옵트인 기능으로 추가한다. 두 방식을 동시에 켤 때의 상호작용(중복 push 등)은 1차 구현 범위에서는 다루지 않고, 우선 "브라우저 sync 미지원 환경(Firefox Android)"을 위한 대안 경로로 도입하는 것을 전제로 한다.

---

## 9) 1차 구현 범위와 이후 과제

**포함**
- Worker + KV 배포, 블롭 GET/PUT/DELETE
- 클라이언트 암호화(HKDF + AES-GCM)
- pull-merge-push 동기화 흐름 + alarm 기반 주기 실행
- 동기화 코드 생성/입력 UI, 분실 안내
- payload 크기 상한(1MB) — 버그로 인한 비정상 데이터 방지 목적의 기본 안전장치

**제외 (문제가 확인되면 대응)**
- IP/계정 기준 rate limiting
- CAPTCHA/Turnstile 등 추가 봇 방어
- 서버측 사용자 인증(계정 등록 절차)
- 다중 동기화 방식(브라우저 sync + 클라우드 동기화) 동시 활성화 시의 충돌 처리

---

## 10) 구현 단계 (제안)

1. Worker/KV 인프라: `wrangler.toml` 작성, KV 네임스페이스 생성, Worker 배포, 수동 curl 테스트
2. `shared/crypto-utils.js`: 코드 생성/파생/암복호화 유닛 테스트
3. `background/cloud-sync-service.js`: 블롭 빌드/병합/push, `mergeHighlights` 재사용 검증
4. `browser.alarms` 등록 + 수동 동기화 진입점(메시지 라우팅에 액션 추가)
5. 온보딩 UI: 코드 생성/복사/입력 화면, 동기화 상태(마지막 동기화 시각, 실패 여부) 표시
6. manifest에 `host_permissions` 추가 (Chrome/Firefox 양쪽)
7. E2E/유닛 테스트: 2-기기 시뮬레이션(pull-merge-push), 코드 오입력 시 복호화 실패 처리, 오프라인 후 복귀 시나리오
8. Firefox Android 실기기(또는 에뮬레이터) 수동 검증

---

## 참고

- `background/sync-service.js` — 기존 `storage.sync` 구현 및 `mergeHighlights`
- `arch-docs/sync-requirements.md` — 동기화 요구사항/충돌 해결 원칙
- `arch-docs/bookmark-sync-based-sync-design.md` — 북마크 기반 대안 설계(비교 참고)
