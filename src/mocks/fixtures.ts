import type { components } from '../api/schema';

type S = components['schemas'];

/** Mock-only: an error log row plus the raw log it was cropped from (not part of the API). */
export type MockErrorLog = Omit<
  S['ErrorLogDetail'],
  'crop' | 'serverName' | 'serverTimezone' | 'latestAnalysis'
> & {
  rawLines: string[];
  cropStart: number;
  cropEnd: number;
  anchorLine: number;
};

// API responses carry timestamps in UTC (contract). Log line text keeps the server's local offset.
const TS = '2026-11-08T00:00:00Z';

export const servers: S['ServerDto'][] = [
  {
    id: 1,
    name: 'order-api',
    host: '10.0.1.21',
    sshPort: 22,
    username: 'deploy',
    authType: 'KEY',
    logPath: '/var/log/order-api/application.log',
    rotatedPattern: 'application-%d{yyyy-MM-dd}-%i.log.gz',
    logPatternKey: 'SPRING_BOOT_3',
    customLogRegex: null,
    timezone: 'Asia/Seoul',
    charset: 'UTF-8',
    hasSecret: true,
    hostKeyFingerprint: 'SHA256:mockOrderApiHostKey0000000000000000000000',
    createdAt: TS,
    updatedAt: TS,
  },
  {
    id: 2,
    name: 'billing-batch',
    host: '10.0.2.8',
    sshPort: 2222,
    username: 'batch',
    authType: 'PASSWORD',
    logPath: '/opt/billing/logs/batch.log',
    rotatedPattern: null,
    logPatternKey: null,
    customLogRegex: '^\\[(?<ts>\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2})\\] (?<level>\\w+)',
    timezone: 'Asia/Seoul',
    charset: 'UTF-8',
    hasSecret: true,
    hostKeyFingerprint: null,
    createdAt: TS,
    updatedAt: TS,
  },
  {
    id: 3,
    name: 'eu-gateway',
    host: '10.8.0.4',
    sshPort: 22,
    username: 'deploy',
    authType: 'KEY',
    logPath: '/var/log/gateway/gateway.log',
    rotatedPattern: null,
    logPatternKey: 'LOGBACK_DEFAULT',
    customLogRegex: null,
    timezone: 'Europe/Berlin',
    charset: 'UTF-8',
    hasSecret: true,
    hostKeyFingerprint: 'SHA256:mockEuGatewayHostKey000000000000000000000',
    createdAt: TS,
    updatedAt: TS,
  },
];

export const logPatterns: S['LogPatternDto'][] = [
  {
    key: 'SPRING_BOOT_3',
    regex: '^(?<ts>\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}[+-]\\d{2}:\\d{2})\\s+(?<level>\\w+)',
    example:
      '2026-11-08T14:31:58.123+09:00 ERROR 4242 --- [order-api] [nio-8080-exec-3] c.f.OrderController : Order failed',
  },
  {
    key: 'LOGBACK_DEFAULT',
    regex: '^(?<ts>\\d{2}:\\d{2}:\\d{2}\\.\\d{3}) \\[[^\\]]+\\] (?<level>\\w+)',
    example: '14:31:58.123 [http-nio-8080-exec-3] ERROR c.f.OrderController - Order failed',
  },
];

export const llmEndpoints: S['LlmEndpointDto'][] = [
  {
    id: 1,
    name: 'internal-vllm',
    baseUrl: 'http://llm.internal:8000',
    model: 'qwen2.5-coder-32b',
    timeoutSec: 120,
    isDefault: true,
    hasSecret: false,
    createdAt: TS,
    updatedAt: TS,
  },
  {
    id: 2,
    name: 'openai',
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
    timeoutSec: 60,
    isDefault: false,
    hasSecret: true,
    createdAt: TS,
    updatedAt: TS,
  },
];

export const prompts: S['PromptTemplateDto'][] = [
  {
    id: 1,
    name: 'Java triage',
    content:
      'You are a senior Java engineer. Server: {{serverName}}, time: {{errorTime}}.\n' +
      'Explain the root cause and suggest a fix for:\n\n{{errorLog}}',
    isDefault: true,
    createdAt: TS,
    updatedAt: TS,
  },
  {
    id: 2,
    name: 'Short summary',
    content: 'Summarize this {{exceptionClass}} in three bullet points:\n\n{{errorLog}}',
    isDefault: false,
    createdAt: TS,
    updatedAt: TS,
  },
];

/** Mock-only: ids referenced by (pre-existing) analyses → DELETE returns 409 IN_USE. */
export const usedLlmEndpointIds = [1];
export const usedPromptIds = [1];

/** Synthetic 400-line raw log with two exception entries (lines 201-210 and 300-305). */
function buildRawLog(): string[] {
  const lines: string[] = [];
  // Linear time scale: line 201 → 14:31:58, line 300 → 14:33:10.
  const at = (no: number) => {
    const s = 14 * 3600 + 25 * 60 + Math.round(418 + ((no - 201) * 72) / 99);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `2026-11-08T${hh}:${mm}:${ss}.000+09:00`;
  };
  for (let no = 1; no <= 400; no++) {
    if (no === 201) {
      lines.push(`${at(no)} ERROR 4242 --- [nio-8080-exec-3] c.f.OrderController : Order failed`);
    } else if (no === 202) {
      lines.push(
        'java.lang.NullPointerException: Cannot invoke "Customer.getId()" because "customer" is null',
      );
    } else if (no >= 203 && no <= 209) {
      lines.push(`\tat com.foo.order.OrderService.place(OrderService.java:${40 + no - 203})`);
    } else if (no === 210) {
      lines.push('\t... 42 more');
    } else if (no === 300) {
      lines.push(`${at(no)} ERROR 4242 --- [nio-8080-exec-7] c.f.OrderRepository : Query failed`);
    } else if (no === 301) {
      lines.push('java.sql.SQLException: Connection is not available, request timed out after 30000ms');
    } else if (no >= 302 && no <= 305) {
      lines.push(`\tat com.zaxxer.hikari.pool.HikariPool.getConnection(HikariPool.java:${180 + no})`);
    } else {
      lines.push(`${at(no)} INFO 4242 --- [nio-8080-exec-1] c.f.OrderController : GET /orders/${no} 200`);
    }
  }
  return lines;
}

/** Exception entries in the raw log: [headerLine, lastStackLine]. */
export const ENTRIES: Record<number, [number, number]> = { 201: [201, 210], 300: [300, 305] };

const cropped: MockErrorLog = {
  id: '20261108-001',
  serverId: 1,
  requestedTime: '2026-11-08T05:32:00Z',
  exceptionClass: 'java.lang.NullPointerException',
  exceptionMessage: 'Cannot invoke "Customer.getId()" because "customer" is null',
  status: 'CROPPED',
  createdAt: '2026-11-08T05:35:10Z',
  windowMin: 5,
  note: null,
  resolution: null,
  resolvedBy: null,
  resolvedAt: null,
  candidates: [
    {
      anchorLine: 201,
      time: '2026-11-08T05:31:58Z',
      exceptionClass: 'java.lang.NullPointerException',
      message: 'Cannot invoke "Customer.getId()" because "customer" is null',
    },
    {
      anchorLine: 300,
      time: '2026-11-08T05:33:10Z',
      exceptionClass: 'java.sql.SQLException',
      message: 'Connection is not available, request timed out after 30000ms',
    },
  ],
  rawLines: buildRawLog(),
  cropStart: 181,
  cropEnd: 220,
  anchorLine: 201,
};

/** Seed error logs, newest first: one CROPPED (used by most tests), plus later statuses for the list. */
export const errorLogs: MockErrorLog[] = [
  cropped,
  {
    ...cropped,
    id: '20261107-002',
    requestedTime: '2026-11-07T23:00:00Z',
    status: 'DEV_REQUIRED',
    createdAt: '2026-11-07T23:04:00Z',
    note: 'customer can be null when the session expired; guard in OrderService.place',
  },
  {
    ...cropped,
    id: '20261107-001',
    serverId: 3,
    requestedTime: '2026-11-07T09:10:00Z',
    exceptionClass: 'java.sql.SQLException',
    exceptionMessage: 'Connection is not available, request timed out after 30000ms',
    status: 'TERMINATED',
    createdAt: '2026-11-07T09:12:30Z',
    note: 'Pool too small for the nightly batch',
    resolution: 'Raised maximumPoolSize to 30 (commit 9f3c2e1)',
    resolvedBy: 'AGENT',
    resolvedAt: '2026-11-07T11:00:00Z',
    anchorLine: 300,
    cropStart: 280,
    cropEnd: 315,
  },
  {
    ...cropped,
    id: '20261106-002',
    status: 'TERMINATED',
    requestedTime: '2026-11-06T02:00:00Z',
    createdAt: '2026-11-06T02:05:00Z',
    resolution: 'Known issue, fixed by the 1.4.2 deploy',
    resolvedBy: 'USER',
    resolvedAt: '2026-11-06T03:00:00Z',
  },
  {
    ...cropped,
    id: '20261106-001',
    serverId: 2,
    requestedTime: '2026-11-06T01:00:00Z',
    status: 'DISCARDED',
    createdAt: '2026-11-06T01:02:00Z',
  },
];
