import { NextResponse } from 'next/server';
import {
  acknowledgeEndpointAlert,
  buildEndpointAlertItems,
  listEndpointAlertMuteRules,
  muteEndpointAlert,
  unmuteEndpointAlert,
  getEndpointAlertRuntimeStates,
  type EndpointAlertMuteScope,
  type EndpointAlertType,
} from '@/lib/endpoint-alerts';
import { listQuotaRecordsFromCache } from '@/lib/quota/service';
import { getSystemSettings } from '@/lib/system-settings';

async function buildResponsePayload() {
  const settings = getSystemSettings();
  const records = await listQuotaRecordsFromCache();
  const muteRules = listEndpointAlertMuteRules();
  const runtimeStates = await getEndpointAlertRuntimeStates(records.map((record) => record.endpointId));
  const alerts = buildEndpointAlertItems(
    records,
    runtimeStates,
    settings.networkErrorAlertConsecutiveThreshold,
    muteRules,
  );

  const recordNameMap = new Map(records.map((record) => [record.endpointId, record.endpointName]));
  const decoratedMuteRules = muteRules.map((rule) => ({
    ...rule,
    endpointName: recordNameMap.get(rule.endpointId) ?? rule.endpointName,
  }));

  return {
    alerts,
    muteRules: decoratedMuteRules,
    settings: {
      networkErrorAlertConsecutiveThreshold: settings.networkErrorAlertConsecutiveThreshold,
    },
  };
}

type ActionBody = {
  action?: 'ack' | 'mute' | 'unmute';
  endpointId?: unknown;
  endpointName?: unknown;
  alertType?: unknown;
  fingerprint?: unknown;
  scope?: unknown;
};

function normalizeEndpointAlertType(value: unknown): EndpointAlertType {
  if (value === 'credential' || value === 'parse_error' || value === 'network_error') {
    return value;
  }
  throw new Error('alertType 非法');
}

function normalizeMuteScope(value: unknown): EndpointAlertMuteScope {
  if (value === 'today' || value === 'permanent') {
    return value;
  }
  throw new Error('scope 非法');
}

export async function GET(): Promise<Response> {
  try {
    const payload = await buildResponsePayload();
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as ActionBody;
    const action = body.action;
    const endpointId = Number(body.endpointId);

    if (!Number.isInteger(endpointId) || endpointId <= 0) {
      return NextResponse.json({ ok: false, message: 'endpointId 非法' }, { status: 400 });
    }

    if (action === 'ack') {
      const alertType = normalizeEndpointAlertType(body.alertType);
      const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint.trim() : '';
      if (!fingerprint) {
        return NextResponse.json({ ok: false, message: 'fingerprint 不能为空' }, { status: 400 });
      }
      await acknowledgeEndpointAlert(endpointId, alertType, fingerprint);
    } else if (action === 'mute') {
      const alertType = normalizeEndpointAlertType(body.alertType);
      const scope = normalizeMuteScope(body.scope);
      const endpointName = typeof body.endpointName === 'string' ? body.endpointName.trim() : null;
      muteEndpointAlert(endpointId, endpointName, alertType, scope);
    } else if (action === 'unmute') {
      const alertType = normalizeEndpointAlertType(body.alertType);
      unmuteEndpointAlert(endpointId, alertType);
    } else {
      return NextResponse.json({ ok: false, message: 'action 非法' }, { status: 400 });
    }

    const payload = await buildResponsePayload();
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
