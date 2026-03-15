import { formatUsd } from "@/lib/utils";
import type {
  PushStructuredMessage,
  PushTaskType,
  PushTestTemplateType,
} from "@/lib/push/types";

export type DailyCheckinSummaryMessageInput = {
  scheduledSlot: string;
  total: number;
  succeeded: number;
  failed: number;
  totalAwardedUsd: number;
  detailRows: Array<{
    vendorName: string;
    detail: string;
  }>;
  startedAt: string;
  finishedAt: string;
};

export type BalanceRefreshMessageInput = {
  total: number;
  success: number;
  failed: number;
  withValue: number;
  detailRows: Array<{
    vendorName: string;
    detail: string;
  }>;
  startedAt: string;
  finishedAt: string;
  isFailure: boolean;
  failureMessage?: string | null;
};

export type VendorUsageAnomalyAlertInput = {
  thresholdPercent: number;
  startedAt: string;
  finishedAt: string;
  rows: Array<{
    vendorName: string;
    usedDeltaUsd: number;
    hubCostUsd: number;
    differenceUsd: number;
    excessPercent: number | null;
  }>;
};

function buildTimeFields(
  startedAt: string,
  finishedAt: string,
): Array<{ label: string; value: string }> {
  return [
    { label: "开始时间", value: startedAt },
    { label: "结束时间", value: finishedAt },
  ];
}

export function buildPushTestMessage(
  targetName: string,
  providerLabel: string,
): PushStructuredMessage {
  return {
    header: {
      title: "推送测试成功",
      icon: "🧪",
      level: "info",
    },
    summary: `这是来自 Claude Code Hub - Quota Monitor 的测试消息，目标：${targetName}（${providerLabel}）。`,
    sections: [
      {
        title: "测试内容",
        content: [
          {
            type: "fields",
            items: [
              { label: "目标名称", value: targetName },
              { label: "推送渠道", value: providerLabel },
            ],
          },
          {
            type: "text",
            value: "如果你收到了这条消息，说明当前渠道配置与消息格式都已生效。",
          },
        ],
      },
    ],
    metadata: {
      taskType: "push_test",
      targetName,
      providerLabel,
    },
    timestamp: new Date().toISOString(),
  };
}

function buildDemoNowRange(): { startedAt: string; finishedAt: string } {
  const finishedAt = new Date().toISOString();
  const startedAt = new Date(Date.now() - 42_000).toISOString();
  return { startedAt, finishedAt };
}

export function buildDailyCheckinSummaryMessage(
  input: DailyCheckinSummaryMessageInput,
): PushStructuredMessage {
  return {
    header: {
      title: "每日签到简报",
      icon: "📅",
      level: input.failed > 0 ? "warning" : "info",
    },
    summary: `定时签到 ${input.scheduledSlot} 已完成，成功 ${input.succeeded}/${input.total}，累计新增 ${formatUsd(input.totalAwardedUsd)} USD。`,
    sections: [
      {
        title: "执行概览",
        content: [
          {
            type: "fields",
            items: [
              { label: "触发时间点", value: input.scheduledSlot },
              { label: "总服务商数", value: String(input.total) },
            ],
          },
          {
            type: "fields",
            items: [
              {
                label: "成功/失败",
                value: `${input.succeeded}/${input.failed}`,
              },
              {
                label: "累计新增额度",
                value: `${formatUsd(input.totalAwardedUsd)} USD`,
              },
            ],
          },
          {
            type: "fields",
            items: [...buildTimeFields(input.startedAt, input.finishedAt)],
          },
        ],
      },
      {
        title: "签到明细",
        content:
          input.detailRows.length > 0
            ? [
                {
                  type: "table",
                  columns: ["服务商", "奖励明细"],
                  rows: input.detailRows.map((item) => ({
                    left: item.vendorName,
                    right: item.detail,
                  })),
                },
              ]
            : [{ type: "text", value: "本轮没有可展示的签到明细。" }],
      },
    ],
    metadata: {
      taskType: "daily_checkin_summary",
      total: input.total,
      succeeded: input.succeeded,
      failed: input.failed,
      totalAwardedUsd: input.totalAwardedUsd,
    },
    timestamp: input.finishedAt,
  };
}

export function buildBalanceRefreshMessage(
  input: BalanceRefreshMessageInput,
): PushStructuredMessage {
  return {
    header: {
      title: input.isFailure ? "签到后余额刷新失败" : "签到后余额刷新简报",
      icon: input.isFailure ? "⚠️" : "💳",
      level: input.isFailure ? "error" : input.failed > 0 ? "warning" : "info",
    },
    summary: input.isFailure
      ? `签到后的强制刷新未成功执行：${input.failureMessage || "未知错误"}`
      : `签到后的强制刷新已完成，成功 ${input.success}/${input.total}，有值 ${input.withValue}。`,
    sections: input.isFailure
      ? [
          {
            title: "失败信息",
            content: [
              {
                type: "quote",
                value: input.failureMessage || "未知错误",
              },
              {
                type: "fields",
                items: buildTimeFields(input.startedAt, input.finishedAt),
              },
            ],
          },
        ]
      : [
          {
            title: "执行概览",
            content: [
              {
                type: "fields",
                items: [
                  { label: "刷新端点数", value: String(input.total) },
                  { label: "成功数", value: String(input.success) },
                  { label: "失败数", value: String(input.failed) },
                  { label: "有值数", value: String(input.withValue) },
                ],
              },
              {
                type: "fields",
                items: buildTimeFields(input.startedAt, input.finishedAt),
              },
            ],
          },
          {
            title: "余额明细",
            content:
              input.detailRows.length > 0
                ? [
                    {
                      type: "table",
                      columns: ["服务商", "余额明细"],
                      rows: input.detailRows.map((item) => ({
                        left: item.vendorName,
                        right: item.detail,
                      })),
                    },
                  ]
                : [{ type: "text", value: "本轮没有可展示的余额明细。" }],
          },
        ],
    metadata: {
      taskType: "daily_checkin_balance_refresh",
      total: input.total,
      success: input.success,
      failed: input.failed,
      withValue: input.withValue,
      isFailure: input.isFailure,
    },
    timestamp: input.finishedAt,
  };
}

export function buildVendorUsageAnomalyAlertMessage(
  input: VendorUsageAnomalyAlertInput,
): PushStructuredMessage {
  return {
    header: {
      title: "服务商消耗异常提醒",
      icon: "🚨",
      level: "warning",
    },
    summary: `刷新后检测到 ${input.rows.length} 个服务商的已用增幅明显高于 CCH 成本增幅，当前阈值为 ${input.thresholdPercent}% 。`,
    sections: [
      {
        title: "异常明细",
        content: [
          {
            type: "table",
            columns: ["服务商", "异常说明"],
            rows: input.rows.map((item) => ({
              left: item.vendorName,
              right: `已用 +${formatUsd(item.usedDeltaUsd)} USD，CCH +${formatUsd(item.hubCostUsd)} USD，差值 +${formatUsd(item.differenceUsd)} USD${item.excessPercent === null ? "" : `，超出 ${formatUsd(item.excessPercent)}%`}`,
            })),
          },
        ],
      },
    ],
    footer: [
      {
        title: "检测口径",
        content: [
          {
            type: "fields",
            items: [
              {
                label: "触发阈值",
                value: `${formatUsd(input.thresholdPercent)}%`,
              },
              ...buildTimeFields(input.startedAt, input.finishedAt),
            ],
          },
        ],
      },
    ],
    metadata: {
      taskType: "daily_checkin_balance_refresh_anomaly",
      thresholdPercent: input.thresholdPercent,
      count: input.rows.length,
    },
    timestamp: input.finishedAt,
  };
}

export function buildPushTestMessageByTemplate(
  templateType: PushTestTemplateType,
  targetName: string,
  providerLabel: string,
): PushStructuredMessage {
  if (templateType === "daily_checkin_summary") {
    const { startedAt, finishedAt } = buildDemoNowRange();
    return buildDailyCheckinSummaryMessage({
      scheduledSlot: "2026-03-11 09:00",
      total: 8,
      succeeded: 7,
      failed: 1,
      totalAwardedUsd: 12.5,
      detailRows: [
        { vendorName: "示例服务商 A", detail: "新增 5.50 USD" },
        { vendorName: "示例服务商 B", detail: "新增 4.00 USD" },
        { vendorName: "示例服务商 C", detail: "签到成功" },
        {
          vendorName: "示例服务商 D",
          detail: "签到失败 · Cookie 已过期，请重新登录",
        },
      ],
      startedAt,
      finishedAt,
    });
  }

  if (templateType === "daily_checkin_balance_refresh") {
    const { startedAt, finishedAt } = buildDemoNowRange();
    return buildBalanceRefreshMessage({
      total: 12,
      success: 10,
      failed: 2,
      withValue: 9,
      detailRows: [
        { vendorName: "服务商 A", detail: "示例端点 Alpha：余额 42.18 USD" },
        { vendorName: "服务商 B", detail: "示例端点 Beta：余额 26.55 USD" },
        {
          vendorName: "服务商 C",
          detail:
            "示例端点 Gamma：余额 18.30 USD\n示例端点 Delta：刷新失败 · 鉴权失败",
        },
        {
          vendorName: "服务商 D",
          detail: "示例端点 Epsilon：刷新失败 · 网络异常",
        },
      ],
      startedAt,
      finishedAt,
      isFailure: false,
    });
  }

  if (templateType === "daily_checkin_balance_refresh_anomaly") {
    const { startedAt, finishedAt } = buildDemoNowRange();
    return buildVendorUsageAnomalyAlertMessage({
      thresholdPercent: 18,
      startedAt,
      finishedAt,
      rows: [
        {
          vendorName: "服务商 A",
          usedDeltaUsd: 23.4,
          hubCostUsd: 14.2,
          differenceUsd: 9.2,
          excessPercent: 64.79,
        },
        {
          vendorName: "服务商 B",
          usedDeltaUsd: 11.8,
          hubCostUsd: 6.4,
          differenceUsd: 5.4,
          excessPercent: 84.38,
        },
      ],
    });
  }

  return buildPushTestMessage(targetName, providerLabel);
}

export function isManagedPushTaskType(value: string): value is PushTaskType {
  return (
    value === "daily_checkin_summary" ||
    value === "daily_checkin_balance_refresh" ||
    value === "daily_checkin_balance_refresh_anomaly"
  );
}
