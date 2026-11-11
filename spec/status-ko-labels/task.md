# PM → Frontend: show error-log statuses in Korean, with descriptions

The dashboard must show the six error-log statuses with Korean labels. Each status also needs a short Korean
description that tells the user what the status means.

## Scope
- **Only the status display text changes.** The rest of the UI stays as it is.
- **API values do not change.** Request/response bodies and the `/errors?status=...` URL params keep the English
  codes (`CROPPED`, `DEV_REQUIRED`, ...). No backend change.

## Labels and descriptions (use this text as written)

| Code | Label | Color (unchanged) | Description |
|---|---|---|---|
| `CROPPED` | 추출됨 | yellow | 지정한 시간대의 로그에서 Java 예외를 찾아 잘라 저장한 상태입니다. 추출된 내용을 확인하고, 부족하면 범위를 넓혀 다시 추출하거나 다른 예외를 선택할 수 있습니다. |
| `CONFIRMED` | 확인됨 | blue | 사용자가 추출된 에러 로그가 올바르다고 확인한 상태입니다. 이제 LLM 분석을 요청할 수 있습니다. |
| `ANALYZED` | 분석됨 | violet | LLM 분석이 완료되어 답변을 받은 상태입니다. 원인을 파악했다면 종료하고, 그렇지 않으면 '개발자 확인 필요'로 넘깁니다. 다시 분석할 수도 있습니다. |
| `DEV_REQUIRED` | 개발자 확인 필요 | orange | 분석 결과만으로는 원인을 알 수 없어 개발자의 확인이 필요한 상태입니다. 외부 코드 에이전트가 MCP로 이 에러를 조회하고 종료할 수 있습니다. |
| `TERMINATED` | 종료됨 | green | 원인을 파악해 처리가 끝난 상태입니다. 사용자 또는 에이전트가 해결 내용을 남기고 종료했습니다. |
| `DISCARDED` | 폐기됨 | gray | 추출된 로그가 찾던 에러가 아니어서 버린 상태입니다. 더 이상 진행되지 않습니다. |

## Where the text appears
1. **One source of truth.** Add `description` to `STATUS_META` in `src/components/StatusBadge.tsx` and export it.
   The `STATUSES` list in `ErrorListPage.tsx` currently repeats the English labels; build it from `STATUS_META` instead.
2. **Status badge** (the `/errors` list and the error detail page): show the Korean label. Hovering the badge shows the
   description in a tooltip (Mantine `Tooltip`, `multiline`, about 300px wide).
3. **`/errors` status filter**: the options show Korean labels. Next to the filter, add a small info icon. Clicking it
   opens a popover titled "상태 안내" that lists all six statuses in lifecycle order, each with its badge and
   description.

## Tests
- Update the unit tests that match the English labels: `StatusBadge.test.tsx`, `Resolution.test.tsx`,
  `AnalysisPanel.test.tsx`, and `ErrorListPage.test.tsx` if affected. Also update `e2e/main-flow.spec.ts`
  (`'Dev required'` → `'개발자 확인 필요'`).
- Add a test that hovering a badge shows its description.
- Add a test that the "상태 안내" popover lists all six statuses.
- Keep the URL-param assertions in English codes. They must stay unchanged.

## Verify
`npm run build`, `npm test` and lint are green, and the e2e test is green. Check in the browser that the badges, the
filter, the tooltip and the popover show Korean and that nothing overflows.

## When done
Tick this task in `todo.md` under a new "Status labels (Korean)" item. Update `structure.md` if needed. Reply with a
short summary and a screenshot of the `/errors` page with the popover open.
