import { NextResponse } from 'next/server';
import { listEndpointSettings } from '@/lib/vendor-settings';
import { listEndpoints } from '@/lib/db';
import { queryEndpointQuotaWithDebug } from '@/lib/quota/adapters';
import { toEndpointIdentity } from '@/lib/quota/service';

export async function POST(
  _request: Request,
  context: { params: Promise<{ vendorId: string }> },
): Promise<Response> {
  try {
    const { vendorId: raw } = await context.params;
    const vendorId = Number(raw);
    if (!Number.isInteger(vendorId) || vendorId <= 0) {
      return NextResponse.json({ ok: false, message: 'vendorId 非法' }, { status: 400 });
    }

    const settings = listEndpointSettings();
    const candidateSettings = settings
      .filter((setting) => setting.vendorId === vendorId)
      .sort((left, right) => left.endpointId - right.endpointId);

    if (candidateSettings.length === 0) {
      return NextResponse.json({ ok: false, message: '该服务商下没有关联端点，无法探测' }, { status: 400 });
    }

    const endpoints = await listEndpoints();
    const endpointMap = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint] as const));

    let latestFailureMessage: string | null = null;

    for (const setting of candidateSettings) {
      const endpoint = endpointMap.get(setting.endpointId);
      if (!endpoint) {
        continue;
      }

      const identity = toEndpointIdentity(endpoint, setting);
      const output = await queryEndpointQuotaWithDebug(identity, {
        vendorType: identity.vendorType,
        vendorId,
      });

      if (output.detectedUserId && output.detectedUserId.trim()) {
        return NextResponse.json({ ok: true, userId: output.detectedUserId.trim() });
      }

      latestFailureMessage = output.result.message || null;
    }

    return NextResponse.json(
      {
        ok: false,
        message: latestFailureMessage || '未命中可用的 user_id 探测结果，请检查类型定义中的 identity/token 查询策略',
      },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
