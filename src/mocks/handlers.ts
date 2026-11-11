import { delay, http, HttpResponse } from 'msw';
import type { components } from '../api/schema';
import { formatInTz } from '../lib/format';
import { missingGroups, rotatedPatternError } from '../lib/logPattern';
import * as fx from './fixtures';

type S = components['schemas'];

// In-memory state so CRUD and status transitions behave like the real API. Reset per test.
let db: {
  servers: S['ServerDto'][];
  deletedServers: S['ServerDto'][]; // soft-deleted
  llmEndpoints: S['LlmEndpointDto'][];
  prompts: S['PromptTemplateDto'][];
  errorLogs: fx.MockErrorLog[];
  analyses: S['AnalysisDto'][];
  /** Mock-only progress of PENDING analyses: polls left, and whether it will fail. */
  analysisRuns: Record<number, { pollsLeft: number; fail: boolean }>;
  usedLlmEndpointIds: number[]; // referenced by analyses → 409 IN_USE on delete
  usedPromptIds: number[];
  seq: number;
};

export function resetDb() {
  db = structuredClone({
    servers: fx.servers,
    deletedServers: [],
    llmEndpoints: fx.llmEndpoints,
    prompts: fx.prompts,
    errorLogs: fx.errorLogs,
    analyses: [],
    analysisRuns: {},
    usedLlmEndpointIds: fx.usedLlmEndpointIds,
    usedPromptIds: fx.usedPromptIds,
    seq: fx.errorLogs.length,
  });
}
resetDb();

const CONTEXT_BEFORE = 20;
const CONTEXT_AFTER = 10;
const EXPAND_STEP = 50;
const MAX_LINES = 2000;
const POLLS_TO_FINISH = 2; // an analysis finishes on its 2nd GET /analyses/{id}

const now = () => new Date().toISOString();
const nextId = (rows: { id: number }[]) => Math.max(0, ...rows.map((r) => r.id)) + 1;

function apiError(status: number, code: string, message: string, details: S['ApiError']['details'] = {}) {
  return HttpResponse.json({ code, message, details } satisfies S['ApiError'], { status });
}
const notFound = (what: string) => apiError(404, 'NOT_FOUND', `${what} not found`);
const invalid = (fields: Record<string, string>) =>
  apiError(400, 'VALIDATION_FAILED', 'Validation failed', { fields });
/** `action` = backend ErrorLogStatusMachine.Action name (RECROP, CONFIRM, DISCARD, START_ANALYSIS, ...). */
const invalidStatus = (log: fx.MockErrorLog, action: string) =>
  apiError(409, 'INVALID_STATUS', `${action} is not allowed in status ${log.status}`, {
    status: log.status,
    action,
  });

/** Name and timezone, also for soft-deleted servers (contract). */
function serverInfo(serverId: number) {
  const server = [...db.servers, ...db.deletedServers].find((s) => s.id === serverId);
  return { serverName: server?.name ?? '?', serverTimezone: server?.timezone ?? 'Asia/Seoul' };
}

function toDetail(log: fx.MockErrorLog): S['ErrorLogDetail'] {
  const { raw, cropStart, cropEnd, anchorLine, ...rest } = log;
  const rawLines = raw[log.instance.id].lines;
  const [head, tail] = fx.ENTRIES[anchorLine];
  return {
    ...rest,
    ...serverInfo(log.serverId),
    // Newest analysis of any status, or an explicit null (contract: nullable fields are never omitted).
    latestAnalysis: db.analyses.find((a) => a.errorLogId === log.id) ?? null,
    crop: {
      startLine: cropStart,
      endLine: cropEnd,
      anchorLine,
      totalLines: rawLines.length,
      expandStep: EXPAND_STEP,
      maxLines: MAX_LINES,
      lines: rawLines.slice(cropStart - 1, cropEnd).map((text, i) => {
        const no = cropStart + i;
        return { no, text, kind: no === head ? 'ANCHOR' : no > head && no <= tail ? 'STACK' : 'CONTEXT' };
      }),
    },
  };
}

function toSummary(log: fx.MockErrorLog): S['ErrorLogSummary'] {
  const {
    id,
    serverId,
    serverName,
    serverTimezone,
    instance,
    requestedTime,
    exceptionClass,
    exceptionMessage,
    status,
    createdAt,
  } = toDetail(log);
  return {
    id,
    serverId,
    serverName,
    serverTimezone,
    instance,
    requestedTime,
    exceptionClass,
    exceptionMessage,
    status,
    createdAt,
  };
}

const rawLinesOf = (log: fx.MockErrorLog) => log.raw[log.instance.id].lines;

/** Moves the crop to a candidate, on that candidate's instance (no re-download). */
function cropAround(log: fx.MockErrorLog, anchorLine: number, instanceId: number) {
  const [head, tail] = fx.ENTRIES[anchorLine];
  log.instance = log.raw[instanceId].ref;
  log.anchorLine = anchorLine;
  log.cropStart = Math.max(1, head - CONTEXT_BEFORE);
  log.cropEnd = Math.min(rawLinesOf(log).length, tail + CONTEXT_AFTER);
}

export const MOCK_REPLY =
  '## Root cause\n`customer` is `null` in `OrderService.place`.\n\n' +
  '## Fix\n```java\nObjects.requireNonNull(customer, "customer");\n```';

/**
 * Advances a PENDING analysis by one poll, like the async backend job. Mock rule: LLM endpoint 2 fails.
 * DONE moves the error log to ANALYZED only if the status machine allows it (CONFIRMED/ANALYZED).
 */
function poll(a: S['AnalysisDto']) {
  const run = db.analysisRuns[a.id];
  if (a.status !== 'PENDING' || !run || --run.pollsLeft > 0) return a;
  a.finishedAt = now();
  if (run.fail) {
    a.status = 'FAILED';
    a.errorMessage =
      'LLM call failed: HTTP 401 from https://api.openai.com/v1/chat/completions (invalid API key)';
  } else {
    a.status = 'DONE';
    a.reply = MOCK_REPLY;
    const log = db.errorLogs.find((l) => l.id === a.errorLogId);
    if (log && (log.status === 'CONFIRMED' || log.status === 'ANALYZED')) log.status = 'ANALYZED';
  }
  return a;
}

const findLog = (id: string) => db.errorLogs.find((l) => l.id === id);

const MAX_INSTANCES = 20;

/** Bean-validation style field keys: `instances`, `instances[1].host`, … (contract v2). */
function validateServer(body: S['ServerUpsert'], existing?: S['ServerDto']) {
  const fields: Record<string, string> = {};
  if (!body.name?.trim()) fields.name = 'must not be blank';
  const instances = body.instances ?? [];
  if (instances.length < 1 || instances.length > MAX_INSTANCES)
    fields.instances = `size must be between 1 and ${MAX_INSTANCES}`;
  const seen = new Set<string>();
  instances.forEach((inst, n) => {
    const at = (f: string) => `instances[${n}].${f}`;
    for (const f of ['host', 'logPath', 'username'] as const)
      if (!inst[f]?.trim()) fields[at(f)] = 'must not be blank';
    const sshPort = inst.sshPort ?? 22;
    if (!(Number.isInteger(sshPort) && sshPort >= 1 && sshPort <= 65535))
      fields[at('sshPort')] = 'must be between 1 and 65535';
    const key = `${inst.host}:${sshPort}:${inst.logPath}`;
    if (seen.has(key) && !fields[at('host')]) fields[at('host')] = 'duplicate host, port and log path';
    seen.add(key);
    const stored = inst.id == null ? undefined : existing?.instances.find((i) => i.id === inst.id);
    if (inst.id != null && !stored) fields[at('id')] = 'not an instance of this server';
    // Secret required for a new instance and when its authType changes; otherwise blank = keep.
    const secretField = inst.authType === 'KEY' ? 'privateKey' : 'password';
    if (inst.id == null || (stored && stored.authType !== inst.authType))
      if (!inst[secretField]) fields[at(secretField)] = 'required';
  });
  if (!body.logPatternKey === !body.customLogRegex)
    fields.logPatternKey = 'exactly one of logPatternKey / customLogRegex is required';
  else if (body.logPatternKey && !fx.logPatterns.some((p) => p.key === body.logPatternKey))
    fields.logPatternKey = 'unknown log pattern';
  if (body.customLogRegex) {
    const missing = missingGroups(body.customLogRegex);
    try {
      new RegExp(body.customLogRegex);
      if (missing.length) fields.customLogRegex = `missing named group(s): ${missing.join(', ')}`;
    } catch {
      fields.customLogRegex = 'invalid regex';
    }
  }
  if (body.rotatedPattern) {
    const error = rotatedPatternError(body.rotatedPattern);
    if (error) fields.rotatedPattern = error;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: body.timezone ?? 'Asia/Seoul' });
  } catch {
    fields.timezone = 'unknown timezone';
  }
  try {
    new TextDecoder(body.charset ?? 'UTF-8');
  } catch {
    fields.charset = 'unknown charset';
  }
  return fields;
}

const allInstances = () => [...db.servers, ...db.deletedServers].flatMap((s) => s.instances);

/**
 * Upsert → active instances, by position. `id` = update that instance (a new host or port forgets its host key),
 * no `id` = new. Instances missing from the list are dropped (error logs keep their InstanceRef snapshot).
 */
function toInstances(body: S['ServerUpsert'], existing?: S['ServerDto']): S['InstanceDto'][] {
  let next = nextId(allInstances());
  return body.instances.map(({ id, password: _p, privateKey: _k, ...u }) => {
    const sshPort = u.sshPort ?? 22;
    const old = existing?.instances.find((i) => i.id === id);
    if (old)
      return {
        ...old,
        ...u,
        sshPort,
        hostKeyFingerprint: u.host === old.host && sshPort === old.sshPort ? old.hostKeyFingerprint : null,
        updatedAt: now(),
      };
    return {
      ...u,
      sshPort,
      id: next++,
      hasSecret: true,
      hostKeyFingerprint: null,
      createdAt: now(),
      updatedAt: now(),
    };
  });
}

/** Mock rule: instance 42 and any host containing "down" are unreachable (search and test). */
const unreachable = (inst: S['InstanceDto']) => inst.id === 42 || inst.host.includes('down');
const timedOut = (inst: S['InstanceDto']) =>
  `Timed out after 10s (connecting to ${inst.username}@${inst.host}:${inst.sshPort})`;

/** Connection test rules: unreachable instances time out, server 2 rejects the login, 31's host key "changed". */
function testFailure(serverId: number, inst: S['InstanceDto']): string | null {
  if (unreachable(inst)) return timedOut(inst);
  if (serverId === 2) return 'Auth fail: password rejected';
  if (inst.id === 31 && inst.hostKeyFingerprint === fx.servers[2].instances[0].hostKeyFingerprint)
    return (
      `Host key of ${inst.host}:${inst.sshPort} changed: trusted ${inst.hostKeyFingerprint}, but the server ` +
      'presented SHA256:mockNewKey. If the server was reinstalled, reset the host key for this server and test ' +
      'again; otherwise the connection may be intercepted. No credentials were sent.'
    );
  return null;
}

/** Names are unique per resource → 409 DUPLICATE_NAME on `name`. */
const duplicateName = (rows: { id: number; name: string }[], name: string, selfId?: number) =>
  rows.some((r) => r.name === name && r.id !== selfId)
    ? apiError(409, 'DUPLICATE_NAME', `"${name}" already exists`, { field: 'name' })
    : undefined;

function validateLlmEndpoint(body: Omit<S['LlmEndpointUpsert'], 'apiKey'>) {
  const fields: Record<string, string> = {};
  for (const f of ['name', 'model'] as const) if (!body[f]?.trim()) fields[f] = 'must not be blank';
  if (!/^https?:\/\/\S+$/.test(body.baseUrl ?? '')) fields.baseUrl = 'must be an http(s) URL';
  if (body.timeoutSec != null && !(body.timeoutSec >= 1 && body.timeoutSec <= 3600))
    fields.timeoutSec = 'must be between 1 and 3600';
  return fields;
}

function validatePrompt(body: S['PromptTemplateUpsert']) {
  const fields: Record<string, string> = {};
  if (!body.name?.trim()) fields.name = 'must not be blank';
  if (!body.content?.includes('{{errorLog}}')) fields.content = 'must contain {{errorLog}}';
  return fields;
}

function setDefault<T extends { id: number; isDefault: boolean }>(rows: T[], row: T) {
  if (!row.isDefault) return;
  for (const r of rows) if (r.id !== row.id) r.isDefault = false;
}

const API = '*/api';

export const handlers = [
  // ── Servers ───────────────────────────────────────────────────────────────
  http.get(`${API}/servers`, () => HttpResponse.json(db.servers)),
  http.post(`${API}/servers`, async ({ request }) => {
    const body = (await request.json()) as S['ServerUpsert'];
    const fields = validateServer(body);
    if (Object.keys(fields).length) return invalid(fields);
    const dup = duplicateName(db.servers, body.name);
    if (dup) return dup;
    const server: S['ServerDto'] = {
      rotatedPattern: null,
      logPatternKey: null,
      customLogRegex: null,
      ...body,
      instances: toInstances(body),
      // Absent or null → the contract defaults.
      timezone: body.timezone ?? 'Asia/Seoul',
      charset: body.charset ?? 'UTF-8',
      id: nextId([...db.servers, ...db.deletedServers]),
      createdAt: now(),
      updatedAt: now(),
    };
    db.servers.push(server);
    return HttpResponse.json(server, { status: 201 });
  }),
  http.put(`${API}/servers/:id`, async ({ request, params }) => {
    const server = db.servers.find((s) => s.id === Number(params.id));
    if (!server) return notFound('Server');
    const body = (await request.json()) as S['ServerUpsert'];
    const fields = validateServer(body, server);
    if (Object.keys(fields).length) return invalid(fields);
    const dup = duplicateName(db.servers, body.name, server.id);
    if (dup) return dup;
    Object.assign(server, { rotatedPattern: null, logPatternKey: null, customLogRegex: null }, body, {
      instances: toInstances(body, server),
      timezone: body.timezone ?? 'Asia/Seoul',
      charset: body.charset ?? 'UTF-8',
      updatedAt: now(),
    });
    return HttpResponse.json(server);
  }),
  http.delete(`${API}/servers/:id`, ({ params }) => {
    const id = Number(params.id);
    const server = db.servers.find((s) => s.id === id);
    if (!server) return notFound('Server');
    // Referenced by error logs → soft-delete: hidden from the list, name still shown on its error logs.
    if (db.errorLogs.some((l) => l.serverId === id)) db.deletedServers.push(server);
    db.servers = db.servers.filter((s) => s.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${API}/servers/:id/test`, async ({ params }) => {
    const server = db.servers.find((s) => s.id === Number(params.id));
    if (!server) return notFound('Server');
    await delay(500);
    const results = server.instances.map((inst): S['InstanceTestResult'] => {
      const { host, sshPort, logPath } = inst;
      const failure = testFailure(server.id, inst);
      if (failure)
        return {
          instanceId: inst.id,
          host,
          sshPort,
          logPath,
          ok: false,
          message: failure,
          logFileFound: false,
          logFileSize: null,
        };
      inst.hostKeyFingerprint ??= `SHA256:mockPinned${inst.id}`; // trusted on first use
      return {
        instanceId: inst.id,
        host,
        sshPort,
        logPath,
        ok: true,
        message: `Connected. Host key ${inst.hostKeyFingerprint}`,
        logFileFound: true,
        logFileSize: 52_428_800,
      };
    });
    return HttpResponse.json<S['ConnectionTestResult']>({ ok: results.every((r) => r.ok), results });
  }),
  http.post(`${API}/servers/:id/instances/:instanceId/reset-host-key`, ({ params }) => {
    const server = db.servers.find((s) => s.id === Number(params.id));
    const inst = server?.instances.find((i) => i.id === Number(params.instanceId));
    if (!server || !inst) return notFound(server ? 'Instance' : 'Server');
    inst.hostKeyFingerprint = null;
    return HttpResponse.json(server);
  }),
  http.get(`${API}/log-patterns`, () => HttpResponse.json(fx.logPatterns)),

  // ── Error logs ────────────────────────────────────────────────────────────
  http.post(`${API}/error-logs/search`, async ({ request }) => {
    const body = (await request.json()) as S['SearchRequest'];
    // An errorTime without offset fails JSON parsing in the backend → 400 BAD_REQUEST (not VALIDATION_FAILED).
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(body.errorTime ?? '') || Number.isNaN(Date.parse(body.errorTime)))
      return apiError(400, 'BAD_REQUEST', 'Malformed request body');
    const windowMin = body.windowMin ?? 5;
    if (!Number.isInteger(windowMin) || windowMin < 1 || windowMin > 1440)
      return invalid({ windowMin: 'must be between 1 and 1440' });
    const server = db.servers.find((s) => s.id === body.serverId); // soft-deleted servers can't be searched
    if (!server) return notFound('Server');
    await delay(1500); // real fetch takes seconds
    // Every instance is read; failed ones are reported, the rest are searched.
    const failures: S['FetchFailure'][] = [];
    const ok: S['InstanceRef'][] = [];
    for (const inst of server.instances) {
      // Mock rules: no instance of server 3 can be read; unreachable instances time out.
      const message =
        server.id === 3
          ? `SFTP: no such file ${inst.logPath} on ${inst.host}`
          : unreachable(inst)
            ? timedOut(inst)
            : null;
      const { id, ...where } = fx.instanceRef(inst);
      if (message) failures.push({ instanceId: id, ...where, message });
      else ok.push({ id, ...where });
    }
    if (!ok.length)
      return apiError(
        502,
        'FETCH_FAILED',
        failures.map((f) => `${f.host}:${f.sshPort}: ${f.message}`).join('; '),
        {
          failures,
        },
      );
    // Mock rule: server 2 never has exceptions.
    if (server.id === 2) {
      const at = Date.parse(body.errorTime);
      return apiError(404, 'NO_EXCEPTION_FOUND', `No exception within ±${windowMin} min`, {
        errorTime: body.errorTime,
        windowMin,
        from: new Date(at - windowMin * 60_000).toISOString(),
        to: new Date(at + windowMin * 60_000).toISOString(),
        searchedInstances: ok,
        failures,
      });
    }
    // Error ID date = creation date in Asia/Seoul (contract).
    const ymd = formatInTz(now(), 'Asia/Seoul').slice(0, 10).replaceAll('-', '');
    const log: fx.MockErrorLog = {
      ...structuredClone(fx.errorLogs[0]),
      ...fx.fetched(ok),
      id: `${ymd}-${String(++db.seq).padStart(3, '0')}`,
      serverId: server.id,
      requestedTime: new Date(body.errorTime).toISOString(), // responses are UTC
      windowMin,
      status: 'CROPPED',
      createdAt: now(),
      fetchFailures: failures,
    };
    db.errorLogs.unshift(log);
    return HttpResponse.json(toDetail(log), { status: 201 });
  }),
  http.get(`${API}/error-logs`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const page = Number(q.get('page') ?? 0);
    const size = Number(q.get('size') ?? 20);
    const fields: Record<string, string> = {};
    if (!(page >= 0)) fields.page = 'must be >= 0';
    if (!(size >= 1 && size <= 100)) fields.size = 'must be between 1 and 100';
    if (Object.keys(fields).length) return invalid(fields);
    // A raw `+` in from/to would decode to a space and fail to parse (the backend rejects it too).
    for (const f of ['from', 'to'])
      if (q.get(f) !== null && Number.isNaN(Date.parse(q.get(f)!)))
        return apiError(400, 'BAD_REQUEST', `Bad ${f}`);
    const statuses = q.getAll('status'); // repeatable
    const rows = db.errorLogs
      .filter(
        (l) =>
          (!statuses.length || statuses.includes(l.status)) &&
          (!q.get('serverId') || l.serverId === Number(q.get('serverId'))) &&
          (!q.get('from') || Date.parse(l.requestedTime) >= Date.parse(q.get('from')!)) &&
          (!q.get('to') || Date.parse(l.requestedTime) <= Date.parse(q.get('to')!)),
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)); // newest first
    const body: S['ErrorLogPage'] = {
      items: rows.slice(page * size, (page + 1) * size).map(toSummary),
      total: rows.length,
      page,
      size,
    };
    return HttpResponse.json(body);
  }),
  http.get(`${API}/error-logs/:id`, ({ params }) => {
    const log = findLog(params.id as string);
    return log ? HttpResponse.json(toDetail(log)) : notFound('Error log');
  }),
  http.patch(`${API}/error-logs/:id/crop`, async ({ request, params }) => {
    const log = findLog(params.id as string);
    if (!log) return notFound('Error log');
    if (log.status !== 'CROPPED') return invalidStatus(log, 'RECROP');
    const body = (await request.json()) as S['CropRequest'];
    if (body.instanceId != null && body.anchorLine == null)
      return invalid({ instanceId: 'Only together with anchorLine' });
    if (body.anchorLine == null && body.expandBefore == null && body.expandAfter == null)
      return invalid({ anchorLine: 'Give expandBefore, expandAfter or anchorLine' });
    if (body.anchorLine != null) {
      // Absent instanceId = the current instance (old clients on single-instance servers).
      const instanceId = body.instanceId ?? log.instance.id;
      if (!log.candidates.some((c) => c.anchorLine === body.anchorLine && c.instanceId === instanceId))
        return invalid({ anchorLine: 'Not a candidate' });
      cropAround(log, body.anchorLine, instanceId);
    }
    // Expansion beyond maxLines is clamped silently (before first, then after).
    if (body.expandBefore)
      log.cropStart = Math.max(1, log.cropStart - body.expandBefore, log.cropEnd - MAX_LINES + 1);
    if (body.expandAfter)
      log.cropEnd = Math.min(
        rawLinesOf(log).length,
        log.cropEnd + body.expandAfter,
        log.cropStart + MAX_LINES - 1,
      );
    return HttpResponse.json(toDetail(log));
  }),
  ...(
    [
      ['confirm', 'CONFIRM', ['CROPPED'], 'CONFIRMED'],
      ['discard', 'DISCARD', ['CROPPED'], 'DISCARDED'],
    ] as const
  ).map(([path, action, from, to]) =>
    http.post(`${API}/error-logs/:id/${path}`, ({ params }) => {
      const log = findLog(params.id as string);
      if (!log) return notFound('Error log');
      if (!(from as readonly string[]).includes(log.status)) return invalidStatus(log, action);
      log.status = to;
      return HttpResponse.json(toDetail(log));
    }),
  ),
  // Backend order: bean validation (400) → error log (404) → status (409).
  http.post(`${API}/error-logs/:id/terminate`, async ({ request, params }) => {
    const resolution = ((await request.json()) as S['TerminateRequest']).resolution?.trim();
    if (!resolution) return invalid({ resolution: 'must not be blank' });
    const log = findLog(params.id as string);
    if (!log) return notFound('Error log');
    if (!['CONFIRMED', 'ANALYZED', 'DEV_REQUIRED'].includes(log.status))
      return invalidStatus(log, 'TERMINATE_BY_USER');
    Object.assign(log, { status: 'TERMINATED', resolution, resolvedBy: 'USER', resolvedAt: now() });
    return HttpResponse.json(toDetail(log));
  }),
  http.post(`${API}/error-logs/:id/dev-required`, async ({ request, params }) => {
    const note = ((await request.json()) as S['DevRequiredRequest']).note?.trim();
    if (!note) return invalid({ note: 'must not be blank' });
    const log = findLog(params.id as string);
    if (!log) return notFound('Error log');
    if (log.status !== 'ANALYZED') return invalidStatus(log, 'DEV_REQUIRED');
    Object.assign(log, { status: 'DEV_REQUIRED', note });
    return HttpResponse.json(toDetail(log));
  }),

  // ── Analyses ──────────────────────────────────────────────────────────────
  http.get(`${API}/error-logs/:id/analyses`, ({ params }) =>
    findLog(params.id as string)
      ? HttpResponse.json(db.analyses.filter((a) => a.errorLogId === params.id)) // newest first
      : notFound('Error log'),
  ),
  http.post(`${API}/error-logs/:id/analyses`, async ({ request, params }) => {
    // Backend order: bean validation (400) → error log (404) → status (409) → endpoint / prompt (404).
    const body = (await request.json()) as Partial<S['AnalysisRequest']>;
    const fields: Record<string, string> = {};
    if (body.llmEndpointId == null) fields.llmEndpointId = 'must not be null';
    if (body.promptTemplateId == null) fields.promptTemplateId = 'must not be null';
    if (Object.keys(fields).length) return invalid(fields); // both required, no server-side default
    const log = findLog(params.id as string);
    if (!log) return notFound('Error log');
    if (!['CONFIRMED', 'ANALYZED'].includes(log.status)) return invalidStatus(log, 'START_ANALYSIS');
    const endpoint = db.llmEndpoints.find((e) => e.id === body.llmEndpointId);
    const prompt = db.prompts.find((p) => p.id === body.promptTemplateId);
    if (!endpoint || !prompt) return notFound(!endpoint ? 'LLM endpoint' : 'Prompt template');
    const analysis: S['AnalysisDto'] = {
      id: nextId(db.analyses),
      errorLogId: log.id,
      llmEndpointId: endpoint.id,
      llmEndpointName: endpoint.name,
      promptTemplateId: prompt.id,
      promptTemplateName: prompt.name,
      status: 'PENDING',
      reply: null,
      errorMessage: null,
      createdAt: now(),
      finishedAt: null,
    };
    db.analyses.unshift(analysis); // newest first
    db.analysisRuns[analysis.id] = { pollsLeft: POLLS_TO_FINISH, fail: endpoint.id === 2 };
    db.usedLlmEndpointIds.push(endpoint.id);
    db.usedPromptIds.push(prompt.id);
    return HttpResponse.json(analysis, { status: 202 });
  }),
  http.get(`${API}/analyses/:id`, ({ params }) => {
    const a = db.analyses.find((x) => x.id === Number(params.id));
    return a ? HttpResponse.json(poll(a)) : notFound('Analysis');
  }),

  // ── LLM endpoints ─────────────────────────────────────────────────────────
  http.get(`${API}/llm-endpoints`, () => HttpResponse.json(db.llmEndpoints)),
  http.post(`${API}/llm-endpoints`, async ({ request }) => {
    const { apiKey, clearApiKey: _c, ...body } = (await request.json()) as S['LlmEndpointUpsert'];
    const fields = validateLlmEndpoint(body);
    if (Object.keys(fields).length) return invalid(fields);
    const dup = duplicateName(db.llmEndpoints, body.name);
    if (dup) return dup;
    const row: S['LlmEndpointDto'] = {
      ...body,
      timeoutSec: body.timeoutSec ?? 120,
      isDefault: body.isDefault ?? false,
      id: nextId(db.llmEndpoints),
      hasSecret: !!apiKey,
      createdAt: now(),
      updatedAt: now(),
    };
    db.llmEndpoints.push(row);
    setDefault(db.llmEndpoints, row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.put(`${API}/llm-endpoints/:id`, async ({ request, params }) => {
    const row = db.llmEndpoints.find((e) => e.id === Number(params.id));
    if (!row) return notFound('LLM endpoint');
    const { apiKey, clearApiKey, ...body } = (await request.json()) as S['LlmEndpointUpsert'];
    const fields = validateLlmEndpoint(body);
    if (apiKey && clearApiKey) fields.apiKey = 'apiKey and clearApiKey cannot be sent together';
    if (Object.keys(fields).length) return invalid(fields);
    const dup = duplicateName(db.llmEndpoints, body.name, row.id);
    if (dup) return dup;
    // Blank apiKey = keep the stored one; clearApiKey removes it.
    const hasSecret = clearApiKey ? false : row.hasSecret || !!apiKey;
    Object.assign(row, body, {
      timeoutSec: body.timeoutSec ?? 120,
      isDefault: body.isDefault ?? false,
      hasSecret,
      updatedAt: now(),
    });
    setDefault(db.llmEndpoints, row);
    return HttpResponse.json(row);
  }),
  http.delete(`${API}/llm-endpoints/:id`, ({ params }) => {
    const id = Number(params.id);
    if (!db.llmEndpoints.some((e) => e.id === id)) return notFound('LLM endpoint');
    if (db.usedLlmEndpointIds.includes(id))
      return apiError(409, 'IN_USE', 'LLM endpoint is referenced by analyses');
    db.llmEndpoints = db.llmEndpoints.filter((e) => e.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${API}/llm-endpoints/:id/test`, async ({ params }) => {
    const row = db.llmEndpoints.find((e) => e.id === Number(params.id));
    if (!row) return notFound('LLM endpoint');
    await delay(700);
    // Mock rule: endpoint 2 fails (like a rejected API key).
    const result: S['LlmTestResult'] =
      row.id === 2
        ? { ok: false, message: 'HTTP 401 from LLM: invalid API key', latencyMs: 180 }
        : { ok: true, message: 'OK', latencyMs: 640 };
    return HttpResponse.json(result);
  }),

  // ── Prompt templates ──────────────────────────────────────────────────────
  http.get(`${API}/prompts`, () => HttpResponse.json(db.prompts)),
  http.post(`${API}/prompts`, async ({ request }) => {
    const body = (await request.json()) as S['PromptTemplateUpsert'];
    const fields = validatePrompt(body);
    if (Object.keys(fields).length) return invalid(fields);
    const dup = duplicateName(db.prompts, body.name);
    if (dup) return dup;
    const row: S['PromptTemplateDto'] = {
      ...body,
      isDefault: body.isDefault ?? false,
      id: nextId(db.prompts),
      createdAt: now(),
      updatedAt: now(),
    };
    db.prompts.push(row);
    setDefault(db.prompts, row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.put(`${API}/prompts/:id`, async ({ request, params }) => {
    const row = db.prompts.find((p) => p.id === Number(params.id));
    if (!row) return notFound('Prompt template');
    const body = (await request.json()) as S['PromptTemplateUpsert'];
    const fields = validatePrompt(body);
    if (Object.keys(fields).length) return invalid(fields);
    const dup = duplicateName(db.prompts, body.name, row.id);
    if (dup) return dup;
    Object.assign(row, body, { isDefault: body.isDefault ?? false, updatedAt: now() });
    setDefault(db.prompts, row);
    return HttpResponse.json(row);
  }),
  http.delete(`${API}/prompts/:id`, ({ params }) => {
    const id = Number(params.id);
    if (!db.prompts.some((p) => p.id === id)) return notFound('Prompt template');
    if (db.usedPromptIds.includes(id))
      return apiError(409, 'IN_USE', 'Prompt template is referenced by analyses');
    db.prompts = db.prompts.filter((p) => p.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),
];
