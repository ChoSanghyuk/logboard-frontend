import { Badge, Tooltip } from '@mantine/core';
import type { components } from '../api/schema';

type ErrorStatus = components['schemas']['ErrorLogSummary']['status'];

/** Display text per status, in lifecycle order. API values stay the English codes. */
// eslint-disable-next-line react-refresh/only-export-components -- single source for the badge and the /errors filter
export const STATUS_META: Record<ErrorStatus, { label: string; color: string; description: string }> = {
  CROPPED: {
    label: '추출됨',
    color: 'yellow',
    description:
      '지정한 시간대의 로그에서 Java 예외를 찾아 잘라 저장한 상태입니다. 추출된 내용을 확인하고, 부족하면 범위를 넓혀 다시 추출하거나 다른 예외를 선택할 수 있습니다.',
  },
  CONFIRMED: {
    label: '확인됨',
    color: 'blue',
    description:
      '사용자가 추출된 에러 로그가 올바르다고 확인한 상태입니다. 이제 LLM 분석을 요청할 수 있습니다.',
  },
  ANALYZED: {
    label: '분석됨',
    color: 'violet',
    description:
      "LLM 분석이 완료되어 답변을 받은 상태입니다. 원인을 파악했다면 종료하고, 그렇지 않으면 '개발자 확인 필요'로 넘깁니다. 다시 분석할 수도 있습니다.",
  },
  DEV_REQUIRED: {
    label: '개발자 확인 필요',
    color: 'orange',
    description:
      '분석 결과만으로는 원인을 알 수 없어 개발자의 확인이 필요한 상태입니다. 외부 코드 에이전트가 MCP로 이 에러를 조회하고 종료할 수 있습니다.',
  },
  TERMINATED: {
    label: '종료됨',
    color: 'green',
    description:
      '원인을 파악해 처리가 끝난 상태입니다. 사용자 또는 에이전트가 해결 내용을 남기고 종료했습니다.',
  },
  DISCARDED: {
    label: '폐기됨',
    color: 'gray',
    description: '추출된 로그가 찾던 에러가 아니어서 버린 상태입니다. 더 이상 진행되지 않습니다.',
  },
};

export function StatusBadge({ status }: { status: ErrorStatus }) {
  const { label, color, description } = STATUS_META[status];
  return (
    <Tooltip label={description} multiline w={300}>
      <Badge color={color} variant="light" miw="max-content">
        {label}
      </Badge>
    </Tooltip>
  );
}
