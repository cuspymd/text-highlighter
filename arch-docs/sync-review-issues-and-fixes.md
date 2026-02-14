# 동기화 구현 리뷰: 5개 핵심 이슈 원인 및 수정안

작성일: 2026-02-14  
대상 파일: `background.js`, `popup.js`, `content.js`, `pages-list.js`  
요구사항 기준: `arch-docs/sync-requirements.md`

## 문서 목적
이 문서는 이전 리뷰에서 식별된 5개 이슈에 대해, 실제 동작 원인과 요구사항 영향, 그리고 구현 가능한 수정안을 상세히 정리한다.

---

## 1) 전체 삭제 전파 불일치 (가장 우선)

### 문제 요약
`deleteAllHighlightedPages` 경로에서 sync 데이터를 일괄 삭제할 때, 수신 기기에서 이를 "사용자 삭제"가 아니라 "용량 초과로 인한 제외(eviction)"로 오인할 가능성이 있다.

### 코드 근거
- 전체 삭제 처리: `background.js:918`
- sync 키 일괄 삭제: `background.js:938`, `background.js:940`
- 메타 초기화(삭제 tombstone 제거): `background.js:942`
- 수신 측 삭제 판정 로직(삭제 tombstone 필요): `background.js:1070`, `background.js:1072`
- tombstone 없으면 eviction 취급: `background.js:1085`

### 왜 발생하는가
현재 설계는 "sync key 제거 이벤트"만으로는 의도를 구분하지 못하고, `sync_meta.deletedUrls[url]`를 보고 "명시적 삭제"인지 판정한다.  
그런데 전체 삭제 경로에서 `deletedUrls`를 비워버리기 때문에, 다른 기기에서 key 제거 이벤트를 받는 시점에 삭제 의도 정보가 사라질 수 있다.

### 요구사항 영향
- 위반 가능: `S-4`, `M-5`, `4.3`
- 기대는 "모든 기기에서 삭제 반영"인데, 일부 기기에 로컬 데이터가 남아 최종 일관성이 깨질 수 있다.

### 수정안 (권장)
1. 전체 삭제 시 "삭제 의도"를 먼저 기록한다.
2. 기록 후 sync key를 제거한다.
3. 즉시 `deletedUrls`를 비우지 말고 tombstone retention 기간 동안 유지한다.

#### 구현 방향 A (최소 침습)
- `deleteAllHighlightedPages`에서 `meta.pages`의 URL 목록으로 `meta.deletedUrls[url] = Date.now()`를 채운 후 `sync_meta` 먼저 저장.
- 그 다음 sync key 일괄 제거.
- `sync_meta` 최종 저장 시에도 `deletedUrls`는 유지하고 `pages`, `totalSize`만 비운다.

#### 구현 방향 B (더 명확)
- `sync_meta`에 `deleteAllAt`(timestamp) 같은 전역 삭제 마커를 추가.
- 수신 측에서 key 제거 + `deleteAllAt`이 최신이면 전체 삭제로 판정.
- 단, 기존 개별 삭제 로직과의 정합성 규칙이 추가로 필요하다.

### 검증 시나리오
1. 기기 A/B 동시 로그인 상태.
2. A에서 "전체 페이지 일괄 삭제" 실행.
3. B에서 열려 있는 페이지와 저장 목록 모두 비워지는지 확인.
4. B 오프라인 후 재온라인에서도 데이터가 재출현하지 않는지 확인.

---

## 2) 동일 URL 다중 탭에서 삭제/갱신 누락

### 문제 요약
로컬 삭제/클리어 시 `notifyTabHighlightsRefresh`가 첫 번째 탭 하나에만 `refreshHighlights`를 보낸다.

### 코드 근거
- 함수 정의: `background.js:540`
- 탭 조회: `background.js:541`
- 단일 탭 전송: `background.js:543`

### 왜 발생하는가
`tabs.query({ url })` 결과가 여러 개여도 `tabs[0]`만 메시지 전송한다.

### 요구사항 영향
- 위반 가능: `M-11` (같은 페이지 열린 상태 즉시 반영)
- 체감 문제: 어떤 탭은 즉시 반영, 어떤 탭은 새로고침 전까지 stale.

### 수정안 (권장)
- `notifyTabHighlightsRefresh`를 모든 매칭 탭 순회 전송으로 변경.
- 탭 개별 실패는 무시하고 계속 전송(현재 다른 브로드캐스트 패턴과 동일).

#### 예시 방향
- `for (const tab of tabs) { try { sendMessage(tab.id, ...)} catch {}}`

### 검증 시나리오
1. 같은 URL을 브라우저 탭 2개 이상으로 열기.
2. 한 탭에서 하이라이트 삭제.
3. 나머지 모든 탭에 즉시 삭제 반영되는지 확인.

---

## 3) 설정 변경의 "로컬 우선" 반영 누락

### 문제 요약
설정 저장(`saveSettings`) 후 다른 열린 탭에 즉시 반영하는 로컬 브로드캐스트가 없다. 결과적으로 sync 이벤트 기반 반영에만 의존한다.

### 코드 근거
- 설정 저장 처리: `background.js:663`
- 저장 로직: `background.js:672`, `background.js:673`
- popup에서 현재 탭 직접 반영: `popup.js:315`, `popup.js:335`
- 전 탭 반영은 sync 변경 이벤트 핸들러에 존재: `background.js:964` 이후

### 왜 발생하는가
설정 적용 경로가 두 갈래다.
- 현재 탭: popup이 직접 메시지 전송
- 다른 탭: storage.sync.onChanged 도착 시 반영

즉 sync 실패/지연/오프라인 상태에서는 "현재 탭 외" 반영이 늦거나 누락될 수 있다.

### 요구사항 영향
- 위반 가능: `S-8`의 "모든 열린 탭 즉시 반영"
- 원칙 충돌: `1.3 로컬 우선` (sync 실패해도 로컬 기능 정상)

### 수정안 (권장)
- `saveSettings` 처리 직후 background에서 로컬 브로드캐스트를 수행한다.
- sync는 별도(비동기)로 시도하되 실패해도 로컬 반영은 완료된 상태로 유지한다.

#### 구현 포인트
1. `saveSettings`에서 변경된 필드만 판별.
2. `tabs.query({})` 후 각 탭에:
   - `minimapVisible` 변경 시 `setMinimapVisibility`
   - `selectionControlsVisible` 변경 시 `setSelectionControlsVisibility`
3. `saveSettingsToSync()` 실패는 로깅만 하고 응답 성공 유지(로컬 우선).

### 검증 시나리오
1. 탭 여러 개 열린 상태에서 네트워크 차단.
2. popup에서 minimap/selection toggle 변경.
3. 모든 열린 탭 즉시 반영되는지 확인.
4. 네트워크 복구 후 타 기기로 설정 전파 확인.

---

## 4) 삭제/편집의 lastUpdated 갱신 누락으로 축출 우선순위 왜곡

### 문제 요약
페이지 내 하이라이트 삭제 시 `lastUpdated`를 갱신하지 않고 기존 메타 값을 재사용한다. 용량 초과 시 "가장 오래전에 수정된 페이지" 규칙이 왜곡될 수 있다.

### 코드 근거
- 축출 정렬 기준: `background.js:141`
- 단일 삭제 후 sync 저장 호출: `background.js:837`
- 전달되는 lastUpdated: `meta.lastUpdated || ''` (삭제 시 갱신 없음)

### 왜 발생하는가
삭제도 명백한 "수정"인데 timestamp를 갱신하지 않아 해당 페이지가 오래된 것으로 계속 간주될 수 있다.

### 요구사항 영향
- 위반 가능: `S-10` (가장 오래전에 수정된 페이지부터 제외)
- 부작용: 최근 편집한 페이지가 예상보다 먼저 sync 대상에서 탈락 가능.

### 수정안 (권장)
- 하이라이트 생성/수정/삭제 모두에서 `lastUpdated = new Date().toISOString()` 갱신.
- `deleteHighlight` 경로에서 `meta.lastUpdated`를 갱신하고 저장 후 sync 호출.
- `clearAllHighlights`(페이지 전체 삭제)는 페이지 데이터 자체가 제거되므로 tombstone timestamp와 충돌 없이 유지.

### 검증 시나리오
1. 페이지 A/B 생성 후 충분한 데이터로 budget 임계 유도.
2. 오래된 A에서 최근 삭제 작업 수행.
3. 이후 신규 저장 시 축출 대상이 B(실제 더 오래된 수정 페이지)인지 확인.

---

## 5) URL 해시 키 충돌 위험

### 문제 요약
`urlToSyncKey`가 32-bit 해시를 base36 문자열로 변환해 sync 키를 만든다. 서로 다른 URL이 동일 키를 가질 수 있다.

### 코드 근거
- 키 생성 함수: `background.js:57`
- 키 사용 위치: `syncSaveHighlights`, `syncRemoveHighlights`, migration, onChanged 처리 전반

### 왜 발생하는가
비암호학적 32-bit 해시는 충돌 확률이 낮아도 0이 아니다. 충돌이 발생하면 서로 다른 페이지 데이터가 같은 sync 슬롯을 공유해 덮어쓰기/오인식이 가능하다.

### 요구사항 영향
- 리스크: `1.3 데이터 보존`, `최종 일관성`
- 실제 빈도는 낮을 수 있으나, 발생 시 피해가 크고 원인 추적이 어렵다.

### 수정안 (권장)

#### 구현 방향 A (권장)
- `crypto.subtle.digest('SHA-256', urlBytes)` 기반으로 안정 키 생성.
- 예: `hl_${hex.slice(0, 32)}` 또는 base64url 일부.
- 충돌 확률을 실질적으로 무시 가능한 수준으로 낮춤.

#### 구현 방향 B (단기 완화)
- 현 해시 유지 + payload 내부 `url` 검증 강화.
- 읽을 때 `stored.url !== expectedUrl`이면 충돌로 판단해 별도 키 재배치.
- 다만 복잡도 대비 근본 해결은 아님.

### 마이그레이션 고려
- 이미 배포된 사용자 데이터를 위해 "구키 읽기 + 신키 쓰기" 이행 기간 필요.
- 점진 이행:
1. 읽기 시 신키 우선, 없으면 구키 탐색.
2. 구키 데이터 발견 시 신키로 복제 저장.
3. 안정화 후 구키 제거.

### 검증 시나리오
1. 신키/구키 혼재 상태에서 설치/업데이트 동작 확인.
2. 기존 데이터 유실 없이 신키로 재저장되는지 확인.
3. 삭제/전체삭제/동기화 병합이 신키 기준으로 정상인지 확인.

---

## 통합 우선순위 제안
1. 이슈 1: 전체 삭제 tombstone 보존 (정합성 치명)
2. 이슈 3: saveSettings 로컬 브로드캐스트 추가 (체감/요구사항 직접 위반)
3. 이슈 2: 다중 탭 refresh 누락 수정 (즉시성)
4. 이슈 4: lastUpdated 갱신 일관화 (정책 정합성)
5. 이슈 5: sync key 강건화 + 마이그레이션 (중장기 안정성)

---

## 권장 테스트 매트릭스 (수정 후)
- 단일 기기: S-2/S-3/S-4/S-8/S-10/S-11
- 다중 기기: M-3/M-4/M-5/M-8/M-11/M-12
- 장애 조건: 오프라인 저장 후 복귀(M-10), sync quota 근접 상태
- 동시성: M-6/M-7/M-14

---

## 결론
현재 구현은 tombstone 기반 충돌 해결과 로컬-원격 병합 구조를 갖추고 있어 기반은 좋다.  
다만 삭제 의도 전파, 로컬 즉시 반영, 업데이트 시각 일관성, 키 충돌 내성에서 보완이 필요하며, 위 5개를 순차 수정하면 요구사항 문서의 핵심 시나리오 충족률이 크게 올라간다.
