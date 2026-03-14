import { createHmac } from 'node:crypto';
import axios from 'axios';
import { ProxyAgent } from 'proxy-agent';
import { getConfig } from '@/lib/config';
import { logInfo } from '@/lib/logger';
import { renderPushPayload } from '@/lib/push/renderers';
import type { PushStructuredMessage, PushTarget, PushTargetTestResult } from '@/lib/push/types';
import { getEffectiveProxyUrl } from '@/lib/system-settings';

type HttpResponse = {
  status: number;
  bodyText: string;
};

const proxyAgentCache = new Map<string, ProxyAgent>();

function getProxyAgent(proxyUrl: string): ProxyAgent {
  const cached = proxyAgentCache.get(proxyUrl);
  if (cached) {
    return cached;
  }

  const created = new ProxyAgent({ getProxyForUrl: () => proxyUrl });
  proxyAgentCache.set(proxyUrl, created);
  return created;
}

function appendDingtalkSignature(urlRaw: string, secret: string | null): string {
  const normalizedSecret = (secret || '').trim();
  if (!normalizedSecret) {
    return urlRaw;
  }

  const timestamp = Date.now();
  const sign = createHmac('sha256', normalizedSecret)
    .update(`${timestamp}\n${normalizedSecret}`)
    .digest('base64');

  const url = new URL(urlRaw);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);
  return url.toString();
}

async function requestByAxios(
  url: string,
  headers: Record<string, string>,
  body: string,
  proxyUrl: string,
): Promise<HttpResponse> {
  const agent = getProxyAgent(proxyUrl);
  const response = await axios.request({
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    data: body,
    responseType: 'text',
    timeout: getConfig().requestTimeoutMs,
    validateStatus: () => true,
    httpAgent: agent,
    httpsAgent: agent,
    proxy: false,
    maxRedirects: 5,
    transitional: {
      forcedJSONParsing: false,
      silentJSONParsing: true,
    },
  });

  return {
    status: response.status,
    bodyText: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
  };
}

async function requestByFetch(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<HttpResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
    cache: 'no-store',
  });

  return {
    status: response.status,
    bodyText: await response.text(),
  };
}

function parseJsonResponse(bodyText: string): Record<string, unknown> | null {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function assertProviderResponse(target: PushTarget, bodyText: string): void {
  if (target.providerType === 'custom') {
    return;
  }

  const json = parseJsonResponse(bodyText);
  if (!json) {
    throw new Error('推送响应不是合法 JSON');
  }

  if (target.providerType === 'wechat') {
    if (json.errcode === 0) {
      return;
    }
    throw new Error(`企业微信推送失败: ${String(json.errmsg ?? json.errcode ?? 'unknown')}`);
  }

  if (target.providerType === 'feishu') {
    if (json.code === 0) {
      return;
    }
    throw new Error(`飞书推送失败: ${String(json.msg ?? json.code ?? 'unknown')}`);
  }

  if (target.providerType === 'dingtalk') {
    if (json.errcode === 0) {
      return;
    }
    throw new Error(`钉钉推送失败: ${String(json.errmsg ?? json.errcode ?? 'unknown')}`);
  }

  if (json.ok === true) {
    return;
  }
  throw new Error(`Telegram 推送失败: ${String(json.description ?? 'unknown')}`);
}

export async function sendPushMessage(target: PushTarget, message: PushStructuredMessage): Promise<PushTargetTestResult> {
  const startedAt = Date.now();

  try {
    const rendered = renderPushPayload(target, message);
    const requestUrl = target.providerType === 'dingtalk'
      ? appendDingtalkSignature(rendered.url, target.dingtalkSecret)
      : rendered.url;

    const proxyUrl = getEffectiveProxyUrl();
    const response = proxyUrl
      ? await requestByAxios(requestUrl, rendered.headers, rendered.body, proxyUrl)
      : await requestByFetch(requestUrl, rendered.headers, rendered.body);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}${response.bodyText ? `: ${response.bodyText}` : ''}`);
    }

    assertProviderResponse(target, response.bodyText);

    const latencyMs = Date.now() - startedAt;
    logInfo('push.send', {
      event: 'success',
      targetId: target.id,
      targetName: target.name,
      providerType: target.providerType,
      latencyMs,
      taskType: message.metadata?.taskType ?? null,
    });

    return {
      success: true,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const messageText = error instanceof Error ? error.message : String(error);
    logInfo('push.send', {
      event: 'failed',
      targetId: target.id,
      targetName: target.name,
      providerType: target.providerType,
      latencyMs,
      taskType: message.metadata?.taskType ?? null,
      message: messageText,
    });
    return {
      success: false,
      error: messageText,
      latencyMs,
    };
  }
}
