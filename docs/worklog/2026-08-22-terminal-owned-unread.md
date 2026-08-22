# 터미널이 갖는 언리드와 그 주변 (2026-08-22)

`feat/terminal-owned-unread` 브랜치(PR #1)에서 한 일과, **다음에 이 근처를 고칠 사람이
모르면 시간을 버리는 것들**을 남긴다. 무엇을 만들었는지는 PR 본문에 있다. 여기에는 그때
드러난 제약과 함정만 적는다.

## 언리드의 소유자

- 소유는 페인이다: `unreadTerminalPanes`(BEL)와 `unreadAgentCompletionPanes`(안 보는 중에
  끝난 턴). 둘 다 페인 키(`tabId:leafId`) 지도다.
- `unreadTerminalTabs`는 **파생 캐시**다 — "내 터미널 중 하나라도 언리드인가". 탭 종·독
  배지·Cmd+J·점프 팔레트가 예전부터 이 필드를 읽고 있어서 남겨 뒀다. **새 소비자는 이걸 쓰지
  말고 `paneHasUnreadActivity`를 부른다.** 이 캐시에 직접 쓰면 페인 지도와 어긋난다.
- 판정 소유자는 `src/renderer/src/lib/terminal-unread.ts` 하나다. 부분 스토어 스냅샷이
  들어와도 죽지 않도록 두 지도를 방어적으로 읽는다(테스트로 고정).

## 언리드가 풀리는 조건

풀리는 것: 그 페인을 눌렀을 때(pointerdown), 그 페인에 입력했을 때, 목록에서 그 행을 눌렀을
때, 그 페인에서 **휠을 굴려 화면이 실제로 움직였을 때**, 그리고 그 페인의 에이전트가 idle에서
다시 working으로 넘어갈 때.

풀리지 **않는** 것: 탭을 누르는 것, 그룹 포커스, 창이 다시 포커스를 얻어 마지막 터미널로
포커스가 돌아가는 것. 이건 취향이 아니라 요구다 — 탭만 눌러도 풀리면 "어느 터미널이 나를
불렀는지"를 잃는다. 포커스를 방아쇠로 쓰면 이 셋이 전부 방아쇠가 되니 **포커스로 되돌리지 말 것.**

휠 판정은 `terminal-wheel-visit.ts`가 소유한다. 이벤트 시점의 뷰포트 위치를 기억했다가 **한
프레임 뒤에** 다시 읽어 비교한다(xterm이 이벤트 처리 뒤에 스크롤을 적용한다). 스크롤이 아예
불가능한 상태(대체 버퍼, 출력이 화면보다 짧음)는 DOM으로 구분되지 않아 방문으로 친다.

## 터미널 이름

순서는 사용자가 지정한 페인 제목 → **그 페인의 실시간 제목** → 에이전트가 보고한 제목 → 탭
제목이다. 탭 제목을 일찍 쓰면 분할된 탭의 터미널 이름이 전부 같아지고 포커스를 따라다닌다.

실시간 제목을 담는 `runtimePaneTitlesByLeafId`(tabId → leafId → 제목)를 새로 뒀다. 기존
`paneTitles`는 **렌더러 로컬 숫자 paneId**로 키가 잡혀 있어서 leafId로 되돌릴 수 없다.
`setRuntimePaneTitle`은 두 지도에 함께 쓴다 — 네 번째 인자(leafId)를 빼면 조용히 옛 지도만
갱신된다.

## 우측 사이드바 탭을 추가할 때

탭 하나를 늘리려면 최소 네 곳에 등록해야 한다: `shared/ui-chrome-types.ts`, 렌더러의 활동
아이템 목록, `right-sidebar-panel-content.tsx`, `main/runtime/rpc/methods/client-ui-schemas.ts`.
여기에 더해 **손으로 적은 허용 목록 셋**(`store/right-sidebar-route.ts`, `main/persistence.ts`,
`worktree-purge-omitters.ts`)이 있고, 목록에 없는 탭 이름은 **오류 없이 `explorer`로 바뀐다.**
"버튼을 눌렀는데 파일 탐색기가 열린다"는 증상이면 이 셋부터 본다.

## Windows 훅 (작업중 아이콘이 안 뜨던 진짜 이유)

- 관리 훅을 `conhost.exe --headless cmd /d /c <script>`로 설치하면 **훅이 하나도 도착하지
  않는다.** conhost가 자식에게 새 콘솔을 붙여 줘서 Claude가 stdin으로 넘기는 페이로드가
  스크립트에 닿지 않는다. Windows 11 26200에서는 자식이 실행조차 안 됐다. `cmd.exe`를 직접
  부른다(`src/main/claude/hook-settings.ts`).
- 이 설정은 **앱이 시작할 때마다 `~/.claude/settings.json`에 다시 쓴다.** 그래서 설치판 Orca를
  한 번 켜면 고친 형식이 옛 형식으로 되돌아간다. 로컬 빌드로 검증할 때는 설치판을 닫아 둔다.
- 훅 스크립트가 보내는 것은 `paneKey`·`tabId`·`launchToken`·`worktreeId`뿐이다. 터미널
  핸들도 PTY id도 안 보낸다. 상태를 다른 축으로 묶고 싶으면 스크립트 생성부터 고쳐야 한다.

## 페인 키 오배정과 검사

훅은 **프로세스가 태어날 때의 페인 키**를 보고한다. 백그라운드 잡으로 띄운 에이전트는 그 잡을
시작한 터미널의 환경을 계속 물고 살기 때문에, 화면에 그 세션을 띄우고 있는 터미널이 따로 있어도
상태는 시작한 터미널에 붙는다. 목록의 `3.3` 같은 번호는 페인 키에서 계산한 값이라 **번호와 페인
키를 대조해도 이 어긋남은 안 잡힌다**(같은 정보의 두 표현이다).

잡히는 근거는 **터미널 자신의 기록**이다(`%APPDATA%/orca/terminal-history/<ptyId>/output.log`).
`shared/pane-binding-audit.ts`가 꼬리를 읽어 세션 id를 세고, 에이전트가 찍은 마지막 답변 한
줄을 더 센 근거로 쓴다. 애매하면 아무것도 하지 않는다 — 스쳐 지나간 언급, 두 터미널이 비슷하게
언급, 묶인 페인의 기록 없음. 정정은 기존 `transferAgentPaneAuthority`로 넘긴다(상태·보존행·언리드
두 지도까지 함께 옮기고 메인에도 알린다).

프로세스 조상으로 판정하는 길도 있다(잡의 호스트는 `claude.exe daemon run` 밑에 살고 페인 셸의
자손이 아니다). 탐지는 되지만 **어느 터미널이 맞는지는 못 알려 준다.** 그래서 기록 대조를 택했다.

## 얕은 비교 셀렉터에 새 리터럴 금지

`useAppStore(useShallow(...))` 안에서 조회가 빗나갔을 때 `?? []`로 새 배열을 만들면, 참조가
매번 달라져 스토어가 항상 바뀐 것으로 보이고 React가 #185(maximum update depth)로 그 영역을
통째로 죽인다. 시작 직후처럼 **워크트리가 아직 없을 때만** 터지므로 개발 중에는 잘 안 보인다.
빈 값은 모듈 상수 하나를 공유한다(`terminal-list-tab-sources.ts`).

## 빌드·실행

- `build-orca.bat` — `dist\win-unpacked`로 빌드한다. pnpm이 PATH에 없으면 corepack 심을
  임시 폴더에 깔아 쓴다(`build:unpack`이 내부에서 `pnpm`을 이름으로 다시 부르기 때문에 필요하다).
  로컬 빌드가 실행 중이면 시작 전에 막는다 — 실행 중이면 패키징이 EPERM으로 중간에 죽는다.
- `run-orca.bat` / `run-orca-isolated.bat` — 후자는 `.orca-profile\`을 따로 써서 설치판 옆에서 돈다.
- 자동 업데이트는 막아 뒀다(`src/main/updater.ts`). 테스트에서만 되살린다
  (`config/scripts/updater-feed-enabled-in-tests.ts`).

## 확장 비용

- **언리드 종류를 늘릴 때**: 지도를 하나 더 만들지 말고 `terminal-unread.ts`의 판정에 넣는다.
  지도를 늘리면 해제 경로 다섯 곳(pointerdown·keydown·목록 클릭·휠·turn 재개)을 전부 고쳐야 한다.
- **상태 아이콘을 늘릴 때**: 목록의 세 갈래(`unread`/`working`/`idle`)는 정렬 키다. 갈래를 늘리면
  `STATUS_RANK`와 탭 사다리(`terminal-tab-activity-status.ts`)를 같이 고친다.
- **검사 규칙을 손댈 때**: 기준값 셋(최소 3회·2배 여유·근거 가중치 5)은 임의값이다. 오탐이
  생기면 값을 흔들기 전에 "무엇을 근거로 삼는가"를 먼저 본다.
