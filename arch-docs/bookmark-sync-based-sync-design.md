# 북마크 기반 동기화 설계안

- Source PDF: `북마크 기반 동기화 설계안.pdf`
- Converted: 2026-03-02 (Asia/Seoul)

---

북마크 기반 동기화 설계안
배경 및 목표
text‑highlighter 는 현재 storage.sync API를 사용하여 하이라이트와 확장 설정을 동기화한다. 이 방식은
항목당 8 KB 제한과 전체 90 KB 예산을 관리하고, 삭제 tombstone 유지, 다중 탭 브로드캐스트 등 다양한 예외 처리를
구현하여 요구 사항을 만족한다 1 2 . 그러나 Firefox Android에서 storage.sync 가 지원되지 않아 안드로이
드 기기 간 동기화가 불가능하다. 북마크는 Chrome·Firefox 데스크톱/Android 모두에서 동기화되며, 개별 항목의 용
량이 수십 KB를 지원하고 전체 5 천 개(파이어폭스 Android)~10만 개(크롬)까지 저장할 수 있어 현 동기화 구조를 대
체할 수 있다. 이 문서는 기존 코드의 데이터 구조와 예외 처리 흐름을 분석한 후, title과 url 필드만 사용하는 북마크
기반 동기화 구조와 동작 시퀀스를 제안한다.

기존 동기화 구조 분석

데이터 구조

   1. 페이지 하이라이트 데이터 – syncKey (URL을 해시한 문자열)로 저장되며, 내용은 { url, title,
    lastUpdated, highlights, deletedGroupIds } 형식이다. highlights 는 그룹별 객체 배열
    로 각 그룹이 groupId , color , ranges , updatedAt 필드를 가진다. 삭제된 그룹은
     deletedGroupIds 에 { groupId: deletedAt } 로 tombstone을 기록한다          3   .
   2. 메타 데이터(sync_meta) – 전체 동기화 예산을 관리하기 위해 { pages: [ { syncKey, url,
    lastUpdated, size } ], deletedUrls, totalSize } 를 저장한다         4   . deletedUrls 는 페
    이지 단위 tombstone(삭제 시간)을 저장하며 30 일 후에 정리된다          5   .
   3. 설정 데이터(settings) – { customColors, minimapVisible,
    selectionControlsVisible } 형식이며, 변경 시 로컬 우선으로 적용하고 전체 탭에 브로드캐스트한
    뒤 동기화한다     6   .

동기화 작업

   1. syncSaveHighlights – 로컬/원격 하이라이트를 mergeHighlights 로 병합하고, JSON 크기가 8 KB를
    넘으면 동기화를 건너뛴다. 총 크기가 90 KB를 넘는 경우 메타의 pages 를 시간순으로 정렬해 가장 오래된
    항목을 제거한다        7   . 삭제 항목은 eviction으로 처리하되, deletedUrls 에 기록하지 않는다.
   2. syncRemoveHighlights – 사용자가 특정 페이지의 하이라이트를 삭제하면 deletedUrls[url] 에
    timestamp를 기록한 뒤 해당 syncKey를 제거한다          8   .
   3. clearAllSyncedHighlights – 전체 삭제 시 메타의 pages 에 있는 URL을 모두 tombstone으로 기록하고,
    모든 syncKey를 제거한 뒤 pages 와 totalSize 만 초기화한다            9   .
   4. migrateLocalToSync – 초기 실행 시 로컬과 원격 데이터를 병합하여 sync에 저장하고, 설정을 병합한다
       10 .

   5. initSyncListener – storage.sync 변경 이벤트를 구독하여 원격 변경을 로컬에 병합하거나 삭제 이벤트
    를 재시도 로직으로 처리한다. 삭제 tombstone이 있으면 사용자 삭제로 판단하여 로컬 데이터를 제거하고 탭
    에 브로드캐스트한다; 없으면 eviction으로 보고 로컬 데이터를 유지한다【865246199359333†L168-
    L200】.

                                           1

북마크 동기화 데이터 구조 제안
크롬과 파이어폭스 모두 북마크에는 폴더, 타이틀(title), URL(url)만 있으며 description 필드는 공통 API가 제공되지
않는다. 따라서 데이터를 url 필드에 base64 또는 URL 인코딩된 JSON으로 저장하고, title 필드에는 페이지
식별자(해시)와 메타 정보를 넣어 인덱싱한다. 모든 북마크는 최상위 폴더 "Text Highlighter Sync"(이하 root) 안에 저
장한다.

구조 요약

 항목            설명             구현 세부 사항

               모든 동기화 데이
 Root
               터를 보관하는 북      이름을 고정("Text Highlighter Sync")하여 존재하지 않으면 생성한다.
 폴더
               마크 폴더.

                              title은 hl_ 접두사 + SHA-256(url)을 사용하여 기존 해시 충돌 문제를 개선
               각 URL별 하이라     한다. url에는 data:application/json;base64,<encoded> 형식의
 페이지
               이트 데이터를 저      JSON을 저장한다. JSON 내용은 기존 구조 { url, title,
 북마크
               장하는 북마크.       lastUpdated, highlights, deletedGroupIds } 를 그대로 사용하
                              여 mergeHighlights 로직을 재사용할 수 있다.

                              title을 "meta", url을 data URL로 하며 { pages, deletedUrls,
               전체 예산·삭제
 메타 북                         totalSize } 구조를 유지한다. pages 배열의 각 항목은 { syncKey,
               tombstone·페이
 마크                           url, lastUpdated, size } . size는 url 문자열의 바이트 길이로 계산한
               지 목록을 관리.
                              다.

                              title을 "settings", url에 JSON
 설정 북          사용자 설정을 동
                               { customColors, minimapVisible,
 마크            기화.
                              selectionControlsVisible } 를 저장한다.

 마이그
               동기화 방식 전환      로컬 storage.local에 bookmarkMigrationDone: true 를 저장해 반복
 레이션
               여부.            마이그레이션을 방지한다.
 플래그

동기화 작업 설계
북마크 API( browser.bookmarks )는 각 항목의 추가/변경/삭제 이벤트를 제공한다. 아래 시퀀스는 기존 동기화 코
드의 예외 처리 규칙을 준수하면서 북마크 구조로 변경하는 방법을 설명한다.

1. 초기화 및 마이그레이션

   1. Root 폴더 준비: 확장 로딩 시 browser.bookmarks.search({ title:
        "Text Highlighter Sync" }) 로 폴더 존재 여부를 확인하고, 없으면 최상위에 생성한다. 폴더 ID를 전
      역 변수로 보관한다.
   2. 마이그레이션 체크: storage.local.get('bookmarkMigrationDone') 가 없으면
        migrateLocalToBookmarks() 를 수행한다. 이 과정은 기존 migrateLocalToSync 를 참고한다
        10 .

   3. 메타 북마크, 설정 북마크, 페이지 북마크들을 모두 읽어 원격(북마크) 데이터를 구성한다.
   4. 로컬 저장소(storage.local)의 모든 페이지 하이라이트와 메타를 읽어 로컬 데이터를 얻는다.
   5. 모든 URL 집합을 합한 후, 각 URL에 대해 기존 mergeHighlights 함수를 사용해 로컬/원격 하이라이트
        를 병합한다      3   .

                                              2

   6. 병합 결과를 로컬 저장소와 북마크 양쪽에 저장하고, 메타 북마크의 pages 목록을 업데이트한다(크기 계산 포
      함).
   7. 설정 데이터는 원격/로컬 데이터를 병합하여 적용하고 북마크에 저장한다 10 .
   8. 완료 후 bookmarkMigrationDone: true 를 storage.local에 저장한다.

2. 하이라이트 저장 (saveHighlightsToBookmarks)

syncSaveHighlights 를 바탕으로 북마크 버전을 구현한다. 이 함수는 하이라이트 UI에서 호출하여 로컬 저장소
와 북마크 모두를 갱신한다.

   1. 로컬 데이터 병합: 인자로 받은 { url, title, highlights, lastUpdated } 와 로컬 메타(삭제
     그룹 정보) 및 원격 북마크 데이터를 읽어 mergeHighlights 로 병합한다.
   2. 직렬화 및 크기 계산: 병합된 데이터 객체를 JSON.stringify 후 base64 인코딩하여 data URL을 만든다.
      newSize는 문자열 바이트 길이로 계산한다. 크기가 8 KB를 초과하면 동기화 작업을 건너뛰고 로컬 저장소만
      갱신한다 11 .
   3. 예산 검사 및 Eviction: 메타 북마크를 읽어 meta.totalSize + newSize 가 예산(기본 90 KB)을 넘으
     면 meta.pages 를 lastUpdated 기준으로 오름차순 정렬하여 오래된 페이지를 순차적으로 제거한다. 제거
     시 북마크 항목을 삭제하고, meta.pages에서 항목을 제거하여 meta.totalSize를 갱신한다. 제거된 URL은
     tombstone에 기록하지 않는다 12 .
   4. 북마크 저장:
   5. SHA-256(url) 값을 사용해 페이지 북마크를 검색한다. 있으면 browser.bookmarks.update 로 url/
     title을 갱신하고 meta.pages의 해당 항목을 업데이트한다. 없으면 browser.bookmarks.create 로 새
      로 만들고 meta.pages에 추가한다.
   6. meta 북마크의 url 데이터(meta)를 갱신한다.
   7. 로컬 저장: 로컬 저장소에 하이라이트 배열과 메타 정보(제목, 마지막 업데이트, 삭제 그룹)를 저장한다.
   8. 브로드캐스트: 새 하이라이트를 모든 탭에 브로드캐스트한다. 기존 코드의
      notifyTabHighlightsRefresh 처럼 동일 URL을 가진 모든 탭에 메시지를 전송해야 하며, 실패한 탭을
     무시하고 반복한다 13 .

3. 하이라이트 삭제 (removeHighlightsFromBookmarks)

사용자가 페이지 하이라이트를 삭제할 때 syncRemoveHighlights 를 북마크 버전으로 재작성한다.

   1. 메타 업데이트: meta 북마크를 읽어 deletedUrls[url] = Date.now() 로 tombstone을 기록하고,
      meta.pages에서 해당 페이지 항목을 제거하여 totalSize를 갱신한다.
   2. 북마크 제거: 페이지 북마크를 찾아 browser.bookmarks.remove 로 삭제한다.
   3. 메타 저장: 변경된 meta를 meta 북마크에 저장한다.
   4. 로컬 저장: 로컬 저장소에서 페이지 데이터를 제거한다.
   5. 브로드캐스트: 해당 URL을 가진 모든 탭에 refreshHighlights 메시지를 보내 빈 배열을 전달한다 14 .

4. 전체 삭제 (clearAllBookmarksHighlights)

clearAllSyncedHighlights 와 동일한 동작을 북마크로 수행한다.

   1. meta 북마크를 읽어 모든 meta.pages의 URL을 반복하며 각 URL을 deletedUrls에 현재 시각으로 기록한다.
   2. 모든 페이지 북마크를 일괄 삭제한다.
   3. meta.pages를 비우고 meta.totalSize를 0으로 설정하지만 deletedUrls는 유지한다 15 .
   4. meta 북마크를 저장하고 로컬 저장소의 모든 페이지 데이터를 제거한다.
   5. 하이라이트 목록 UI를 초기화한다.

                                         3

5. 설정 저장 및 동기화 (saveSettingsToBookmarks)

설정은 별도의 북마크에 저장한다.

      1. 로컬 우선 적용: 사용자가 설정을 변경하면 즉시 storage.local에 저장하고, 변경된 필드를 모든 탭에 브로드캐
         스트한다 16 .
      2. 북마크 저장: 설정 북마크를 찾아 { customColors, minimapVisible,
        selectionControlsVisible } 를 JSON으로 직렬화해 url에 저장한다. 북마크가 없으면 새로 생성한
         다.
      3. 오류 허용: 북마크 저장 실패 시 로깅만 하고 로컬 적용은 유지한다.

6. 동기화 이벤트 리스너 (initBookmarkSyncListener)

browser.bookmarks.onChanged 와 onRemoved 를 이용해 북마크 변경을 감지하고 원격 변경을 로컬에 반영
한다.

      1. 설정 변경 감지: title이 "settings"인 북마크가 변경되면 JSON을 파싱하여 로컬 설정에 적용하고 탭에 브로드
         캐스트한다.
      2. 페이지 변경 감지: title이 hl_ 접두사인 북마크가 추가되거나 수정되면 JSON을 파싱해 { url,
        highlights, deletedGroupIds, lastUpdated } 를 얻는다. 로컬 하이라이트와 병합
        ( mergeHighlights ) 후 저장하고 모든 탭에 업데이트를 전송한다 17 .
      3. 페이지 삭제 감지: onRemoved 이벤트에서 title이 hl_ 접두사인 북마크가 삭제되면 다음을 수행한다.
      4. tombstone을 확인한다. meta 북마크의 deletedUrls에 url 값이 존재하면 사용자 삭제로 판단하여 로컬 데이
         터를 제거하고 탭에 브로드캐스트한다【865246199359333†L168-L200】.
      5. tombstone이 없으면 eviction으로 판단하여 로컬 하이라이트를 유지한다.
      6. 위 판정을 위해 deletedUrls는 tombstone retention 기간(30 일) 동안 유지한다 5 .
      7. 삭제 이벤트 직후 tombstone을 찾지 못한 경우 일정 시간 후 재확인하는 retry 로직을 구현한다. 기존 코드의
         SYNC_REMOVAL_RECHECK_DELAY_MS와 SYNC_REMOVAL_MAX_RETRIES 값을 그대로 사용하여 재검
         사한다 18 .

7. 기타 고려 사항

      1. 해시 충돌 방지: 현재 urlToSyncKey는 32‑bit 해시를 사용하며 충돌 가능성이 있다. 북마크 키에는
         SHA-256(url)을 base36으로 인코딩해 사용한다. 이전 키를 사용하는 기기와의 호환을 위해 meta 북마크에
         구 버전 키 목록을 저장하고, 첫 마이그레이션 시 두 키를 모두 탐색한다 6 .
      2. 데이터 크기 제한: 북마크의 url 필드는 약 수십 KB까지 지원된다. 페이지 하이라이트가 거대해지는 것을 방지
         하기 위해 기존 8 KB 제한을 유지하고 초과 시 북마크 동기화를 건너뛴다 11 .
      3. 예산 관리: Android Firefox는 북마크가 5 천개를 초과하면 동기화하지 않으므로, 전체 예산(페이지 수)도 5 천
         개 이하로 제한해야 한다. meta.pages 길이를 검사하여 초과 시 오래된 페이지를 순차적으로 삭제한다.
      4. 다국어 지원 및 코드 분리: 북마크 로직은 기존 sync-service.js를 대체하는 새로운 bookmark-sync-
         service.js로 구현하고, settings-service.js에서 saveSettingsToSync를 saveSettingsToBookmarks로 교
         체한다.
      5. 테스트: 기존 E2E 테스트를 업데이트하여 북마크 기반 동기화에서 tombstone 유지, 다중 탭 브로드캐스트, 설
         정 로컬우선 적용 등을 검증한다.

결론
북마크 기반 동기화는 Firefox Android의 동기화 부재를 해결하면서도 기존 storage.sync 구현에서 중요하게 다루었
던 예외 사항을 모두 유지할 수 있다. 페이지별 북마크와 메타·설정 북마크를 사용하여 하이라이트와 설정을 저장하고,
기존 mergeHighlights 와 tombstone 로직을 그대로 적용함으로써 충돌 해결과 삭제 판정 문제를 해결한다. 예

                                               4

산·크기 제한과 삭제 재시도 로직을 따라 Chrome/Firefox(데스크톱·Android) 간 일관된 동기화 경험을 제공할 수 있
다.

 1   2    3    4    5   7   8   9   10   11   12   14   17   18   raw.githubusercontent.com
https://raw.githubusercontent.com/cuspymd/text-highlighter/main/background/sync-service.js

 6   13   15   16   raw.githubusercontent.com
https://raw.githubusercontent.com/cuspymd/text-highlighter/main/arch-docs/sync-review-issues-and-fixes.md

                                                                    5
