# 북마크 기반 동기화 설계안

## 배경 및 목표

text-highlighter는 현재 `storage.sync` API를 사용해 하이라이트와 확장 설정을 동기화한다. 현 구조는 항목당 8KB 제한, 전체 90KB 예산 관리, 삭제 tombstone 유지, 다중 탭 브로드캐스트 등 다양한 예외 처리까지 포함해 요구사항을 충족한다.

다만 Firefox Android에서 `storage.sync`가 지원되지 않아, Android 기기 간 동기화가 불가능하다는 한계가 있다. 반면 북마크는 Chrome/Firefox 데스크톱·Android 전반에서 동기화되며, 개별 항목 수십 KB 수준 저장과 충분한 전체 저장 한도를 제공한다.

이 문서는 기존 동기화 구조를 분석하고, 북마크의 `title`/`url` 필드만으로 동작하는 북마크 기반 동기화 구조와 실행 시퀀스를 제안한다.

---

## 1) 기존 동기화 구조 분석

### 데이터 구조

1. **페이지 하이라이트 데이터**
   - `syncKey`(URL 해시 문자열)를 키로 사용
   - 값 구조:
     ```json
     {
       "url": "...",
       "title": "...",
       "lastUpdated": 0,
       "highlights": [],
       "deletedGroupIds": {}
     }
     ```
   - `highlights`는 그룹 단위 배열이며 각 그룹은 `groupId`, `color`, `ranges`, `updatedAt` 필드를 가짐
   - 삭제 그룹은 `deletedGroupIds`에 `{ groupId: deletedAt }` 형태 tombstone으로 기록

2. **메타 데이터(`sync_meta`)**
   - 전체 동기화 예산 관리용 데이터
   - 구조: `{ pages, deletedUrls, totalSize }`
   - `pages` 항목: `{ syncKey, url, lastUpdated, size }`
   - `deletedUrls`는 페이지 단위 tombstone(삭제 시각)을 저장하며 30일 후 정리

3. **설정 데이터(`settings`)**
   - 구조: `{ customColors, minimapVisible, selectionControlsVisible }`
   - 변경 시 로컬 우선 적용 후 전체 탭 브로드캐스트, 이후 동기화

### 동기화 작업

1. **`syncSaveHighlights`**
   - 로컬/원격 하이라이트를 `mergeHighlights`로 병합
   - JSON 크기가 8KB를 초과하면 동기화 건너뜀
   - 총 크기 90KB 초과 시 `pages`를 오래된 순으로 정렬해 eviction
   - eviction 항목은 `deletedUrls` tombstone에 기록하지 않음

2. **`syncRemoveHighlights`**
   - 특정 페이지 삭제 시 `deletedUrls[url] = timestamp` 기록
   - 해당 `syncKey` 데이터 제거

3. **`clearAllSyncedHighlights`**
   - 전체 삭제 시 `pages`의 모든 URL을 tombstone 처리
   - 모든 `syncKey` 제거 후 `pages`, `totalSize` 초기화

4. **`migrateLocalToSync`**
   - 초기 실행 시 로컬/원격 데이터 병합 후 sync 저장
   - 설정도 병합

5. **`initSyncListener`**
   - `storage.sync` 변경 이벤트 수신
   - tombstone 존재 시 사용자 삭제로 판단해 로컬 제거 + 탭 브로드캐스트
   - tombstone이 없으면 eviction으로 판단해 로컬 유지

---

## 2) 북마크 기반 동기화 데이터 구조 제안

Chrome/Firefox 공통 북마크 API는 폴더, `title`, `url`만 안정적으로 사용 가능하다. 따라서 payload는 `url` 필드(인코딩된 JSON)에 저장하고, `title`은 인덱싱/식별 용도로 사용한다.

모든 동기화 데이터는 최상위 폴더 **"Text Highlighter Sync"**(이하 `root`) 아래에 저장한다.

### 구조 요약

| 항목 | 설명 | 구현 세부 사항 |
|---|---|---|
| Root 폴더 | 모든 동기화 데이터 보관 폴더 | 이름을 `Text Highlighter Sync`로 고정. 없으면 생성 |
| 페이지 북마크 | URL별 하이라이트 데이터 | `title`: `hl_` + `SHA-256(url)` / `url`: `data:application/json;base64,<encoded>` |
| 메타 북마크 | 예산·삭제 tombstone·페이지 목록 관리 | `title`: `meta` / payload: `{ pages, deletedUrls, totalSize }` |
| 설정 북마크 | 사용자 설정 동기화 | `title`: `settings` / payload: `{ customColors, minimapVisible, selectionControlsVisible }` |
| 마이그레이션 플래그 | 전환 완료 여부 | `storage.local.bookmarkMigrationDone = true` |

> 페이지 payload는 기존 구조 `{ url, title, lastUpdated, highlights, deletedGroupIds }`를 유지해 `mergeHighlights` 재사용 가능.

---

## 3) 동기화 작업 설계

### 3.1 초기화 및 마이그레이션

1. 확장 로딩 시 `root` 폴더 존재 확인(`browser.bookmarks.search`) 후 없으면 생성
2. `storage.local.get('bookmarkMigrationDone')` 확인
3. 미완료 시 `migrateLocalToBookmarks()` 수행
   - 메타/설정/페이지 북마크로 원격 데이터 구성
   - 로컬 저장소 데이터 로드
   - URL 합집합 기준 `mergeHighlights` 병합
   - 병합 결과를 로컬 + 북마크 양쪽에 저장
   - 메타 `pages`/`totalSize` 재계산
   - 설정도 로컬/원격 병합 후 저장
4. 완료 시 `bookmarkMigrationDone: true` 저장

### 3.2 하이라이트 저장 (`saveHighlightsToBookmarks`)

1. 입력 데이터와 로컬 메타/원격 북마크 데이터를 읽어 `mergeHighlights` 수행
2. 병합 결과를 직렬화(JSON) 후 base64 인코딩하여 data URL 생성
3. `newSize`(바이트 길이) 계산
   - 8KB 초과 시 북마크 동기화는 건너뛰고 로컬만 갱신
4. 예산 검사
   - `meta.totalSize + newSize`가 예산(기본 90KB) 초과 시 오래된 페이지부터 eviction
   - eviction 항목은 tombstone에 기록하지 않음
5. 페이지 북마크 upsert
   - 있으면 `browser.bookmarks.update`
   - 없으면 `browser.bookmarks.create`
6. `meta` 북마크 갱신(`pages`, `totalSize`)
7. 로컬 저장소 갱신
8. 동일 URL 탭 전체에 하이라이트 갱신 브로드캐스트(실패 탭은 무시)

### 3.3 하이라이트 삭제 (`removeHighlightsFromBookmarks`)

1. `meta.deletedUrls[url] = Date.now()` 기록
2. `meta.pages`에서 해당 항목 제거 및 `totalSize` 갱신
3. 페이지 북마크 삭제
4. 갱신된 `meta` 저장
5. 로컬 저장소에서 페이지 데이터 제거
6. 해당 URL 탭에 빈 하이라이트 브로드캐스트

### 3.4 전체 삭제 (`clearAllBookmarksHighlights`)

1. `meta.pages`의 모든 URL을 `deletedUrls` tombstone으로 기록
2. 모든 페이지 북마크 삭제
3. `meta.pages = []`, `meta.totalSize = 0`으로 초기화 (`deletedUrls`는 유지)
4. `meta` 저장
5. 로컬 저장소 페이지 데이터 제거 및 UI 초기화

### 3.5 설정 저장/동기화 (`saveSettingsToBookmarks`)

1. 사용자 설정 변경 시 로컬에 즉시 반영
2. 변경 필드를 전체 탭에 브로드캐스트
3. 설정 북마크에 JSON 저장(없으면 생성)
4. 북마크 저장 실패 시 로깅만 수행하고 로컬 상태는 유지

### 3.6 동기화 이벤트 리스너 (`initBookmarkSyncListener`)

- `browser.bookmarks.onChanged`, `onRemoved`를 구독

1. **설정 변경 감지**
   - `title === "settings"` 변경 시 payload 파싱 후 로컬 적용 + 탭 브로드캐스트

2. **페이지 변경 감지**
   - `title`이 `hl_` 접두사면 payload 파싱
   - `{ url, highlights, deletedGroupIds, lastUpdated }`를 로컬과 병합 후 저장
   - 모든 탭에 업데이트 전송

3. **페이지 삭제 감지**
   - tombstone(`meta.deletedUrls[url]`) 존재 시 사용자 삭제로 판정 → 로컬 제거 + 브로드캐스트
   - tombstone 미존재 시 eviction으로 판정 → 로컬 유지
   - tombstone은 30일 유지
   - 삭제 직후 tombstone 미확인 시 재시도 로직 적용
     (`SYNC_REMOVAL_RECHECK_DELAY_MS`, `SYNC_REMOVAL_MAX_RETRIES` 재사용)

---

## 4) 기타 고려 사항

1. **해시 충돌 방지**
   - 기존 `urlToSyncKey`의 32-bit 해시 대신 `SHA-256(url)`(base36 인코딩) 사용
   - 마이그레이션 호환을 위해 구버전 키도 탐색 가능하도록 메타에 보조 정보 유지

2. **데이터 크기 제한**
   - 북마크 `url` 필드는 수십 KB 저장 가능하더라도 기존 8KB 제한 유지
   - 초과 시 북마크 동기화 skip + 로컬만 저장

3. **예산/개수 관리**
   - Firefox Android의 동기화 한계를 고려해 페이지 수 상한(예: 5,000) 관리
   - 초과 시 오래된 페이지부터 제거

4. **코드 분리**
   - `sync-service.js` 대체용 `bookmark-sync-service.js` 신설
   - `settings-service.js`의 `saveSettingsToSync`를 `saveSettingsToBookmarks`로 교체

5. **테스트**
   - E2E 테스트 보강: tombstone 유지, 다중 탭 브로드캐스트, 설정 로컬 우선 적용, 삭제 재시도

---

## 결론

북마크 기반 동기화는 Firefox Android의 `storage.sync` 미지원 문제를 해소하면서도, 기존 구현이 해결해온 핵심 예외 처리(충돌 병합, tombstone 기반 삭제 판정, eviction 구분, 다중 탭 반영)를 유지할 수 있다.

즉, 페이지/메타/설정 북마크로 역할을 분리하고 기존 병합 로직을 재사용하면 Chrome/Firefox(데스크톱·Android) 전반에서 일관된 동기화 경험을 제공할 수 있다.

---

## 참고

- `background/sync-service.js`  
  https://raw.githubusercontent.com/cuspymd/text-highlighter/main/background/sync-service.js
- `arch-docs/sync-review-issues-and-fixes.md`  
  https://raw.githubusercontent.com/cuspymd/text-highlighter/main/arch-docs/sync-review-issues-and-fixes.md
