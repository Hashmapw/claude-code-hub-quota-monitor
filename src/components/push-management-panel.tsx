"use client";

import {
  Bell,
  CheckCircle2,
  Edit3,
  Eye,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  TestTube2,
  Trash2,
  Webhook,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type PushDeliveryRecord,
  getPushProviderLabel,
  getPushTaskLabel,
  type PushProviderType,
  type PushStructuredMessage,
  type PushTarget,
  type PushTaskConfig,
  type PushTaskType,
  type PushTestTemplateType,
} from "@/lib/push/types";
import {
  applyTemplateValue,
  buildCanonicalPayload,
  renderFeishuElements,
  renderMarkdownBody,
  renderTelegramBody,
} from "@/lib/push/renderers";
import { toast } from "@/lib/toast";
import { cn, formatDateTime } from "@/lib/utils";

type ActionResult<T> = {
  ok: boolean;
  message?: string;
  target?: PushTarget;
  task?: PushTaskConfig;
  result?: {
    success: boolean;
    error?: string;
    latencyMs?: number;
  };
  payload?: T;
};

type TargetSubmitPayload = Record<string, unknown>;

type PushManagementPanelProps = {
  records: PushDeliveryRecord[];
  targets: PushTarget[];
  tasks: PushTaskConfig[];
  onCreateTarget: (
    input: TargetSubmitPayload,
  ) => Promise<ActionResult<PushTarget>>;
  onUpdateTarget: (
    targetId: string,
    input: TargetSubmitPayload,
  ) => Promise<ActionResult<PushTarget>>;
  onDeleteTarget: (targetId: string) => Promise<ActionResult<void>>;
  onTestTarget: (
    targetId: string,
    templateType: PushTestTemplateType,
  ) => Promise<ActionResult<PushTarget>>;
  onSaveTask: (
    taskType: PushTaskType,
    input: { enabled: boolean; targetIds: string[] },
  ) => Promise<ActionResult<PushTaskConfig>>;
  onRefreshRecords: () => Promise<ActionResult<PushDeliveryRecord[]>>;
};

type TargetFormValue = {
  name: string;
  providerType: PushProviderType;
  webhookUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  dingtalkSecret: string;
  customHeaders: string;
  customTemplate: string;
  isEnabled: boolean;
};

const DEFAULT_FORM: TargetFormValue = {
  name: "",
  providerType: "feishu",
  webhookUrl: "",
  telegramBotToken: "",
  telegramChatId: "",
  dingtalkSecret: "",
  customHeaders: "",
  customTemplate: "",
  isEnabled: true,
};

function buildFormValue(target?: PushTarget): TargetFormValue {
  if (!target) {
    return DEFAULT_FORM;
  }

  return {
    name: target.name,
    providerType: target.providerType,
    webhookUrl: target.webhookUrl ?? "",
    telegramBotToken: target.telegramBotToken ?? "",
    telegramChatId: target.telegramChatId ?? "",
    dingtalkSecret: target.dingtalkSecret ?? "",
    customHeaders: target.customHeaders
      ? JSON.stringify(target.customHeaders, null, 2)
      : "",
    customTemplate: target.customTemplate
      ? JSON.stringify(target.customTemplate, null, 2)
      : "",
    isEnabled: target.isEnabled,
  };
}

function buildTargetSubmitPayload(
  formValue: TargetFormValue,
): TargetSubmitPayload {
  const base = {
    name: formValue.name,
    providerType: formValue.providerType,
    isEnabled: formValue.isEnabled,
  } as Record<string, unknown>;

  if (formValue.providerType === "telegram") {
    return {
      ...base,
      telegramBotToken: formValue.telegramBotToken,
      telegramChatId: formValue.telegramChatId,
    };
  }

  if (formValue.providerType === "dingtalk") {
    return {
      ...base,
      webhookUrl: formValue.webhookUrl,
      dingtalkSecret: formValue.dingtalkSecret,
    };
  }

  if (formValue.providerType === "custom") {
    return {
      ...base,
      webhookUrl: formValue.webhookUrl,
      customHeaders: formValue.customHeaders,
      customTemplate: formValue.customTemplate,
    };
  }

  return {
    ...base,
    webhookUrl: formValue.webhookUrl,
  };
}

function TargetProviderBadge({
  providerType,
}: {
  providerType: PushProviderType;
}) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-[11px] font-bold tracking-wide text-foreground/80">
      {getPushProviderLabel(providerType)}
    </span>
  );
}

function MiniSwitch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "border-primary/40 bg-primary/70" : "border-border bg-muted",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-background shadow-sm ring-1 ring-black/5 transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function getTaskDescription(taskType: PushTaskType): string {
  if (taskType === "daily_checkin_balance_refresh_anomaly") {
    return "自动刷新后检测消耗异常并告警";
  }
  if (taskType === "daily_checkin_balance_refresh") {
    return "签到成功后刷新余额并推送结果";
  }
  return "签到成功后发送签到结果摘要";
}

function getPushTestTemplateLabel(templateType: PushTestTemplateType): string {
  if (templateType === "push_test") {
    return "通用测试消息";
  }
  return getPushTaskLabel(templateType);
}

function getTaskTriggerSummary(taskType: PushTaskType): string {
  if (taskType === "daily_checkin_balance_refresh_anomaly") {
    return "由定时自动刷新触发";
  }
  return "由定时每日签到触发";
}

function getTaskIcon(taskType: PushTaskType) {
  if (taskType === "daily_checkin_summary") {
    return <Send className="h-4 w-4" />;
  }
  if (taskType === "daily_checkin_balance_refresh") {
    return <RefreshCw className="h-4 w-4" />;
  }
  return <ShieldAlert className="h-4 w-4" />;
}

function getTaskIconClassName(taskType: PushTaskType): string {
  if (taskType === "daily_checkin_summary") {
    return "bg-sky-500/10 text-sky-600";
  }
  if (taskType === "daily_checkin_balance_refresh") {
    return "bg-indigo-500/10 text-indigo-600";
  }
  return "bg-amber-500/10 text-amber-700";
}

function getRecordTypeLabel(record: PushDeliveryRecord): string {
  if (record.templateType === "push_test") {
    return "通用测试消息";
  }
  return getPushTaskLabel(record.templateType);
}

type PreviewMode = "feishu" | "markdown" | "telegram" | "custom";

type PreviewModeOption = {
  id: PreviewMode;
  label: string;
};

const PREVIEW_MODE_OPTIONS: PreviewModeOption[] = [
  { id: "feishu", label: "卡片元素" },
  { id: "markdown", label: "Markdown" },
  { id: "telegram", label: "Telegram HTML" },
  { id: "custom", label: "自定义 JSON" },
];

function getDefaultPreviewMode(providerType: PushProviderType): PreviewMode {
  if (providerType === "wechat" || providerType === "dingtalk") {
    return "markdown";
  }
  if (providerType === "telegram") {
    return "telegram";
  }
  if (providerType === "custom") {
    return "custom";
  }
  return "feishu";
}

function getMarkdownText(message: PushStructuredMessage): string {
  return renderMarkdownBody(message).join("\n").trim();
}

function getTelegramHtml(message: PushStructuredMessage): string {
  return renderTelegramBody(message);
}

function getCustomJsonText(
  message: PushStructuredMessage,
  customTemplate?: Record<string, unknown> | null,
): string {
  const canonical = buildCanonicalPayload(message);
  if (!customTemplate) {
    return JSON.stringify(canonical, null, 2);
  }
  return JSON.stringify(applyTemplateValue(customTemplate, canonical), null, 2);
}

function getFeishuMarkdownContent(element: Record<string, unknown>): string {
  const content = element.content;
  return typeof content === "string" ? content : "";
}

function getFeishuHeaderClassName(
  level: PushStructuredMessage["header"]["level"],
): string {
  if (level === "error") {
    return "bg-[#e34d59]";
  }
  if (level === "warning") {
    return "bg-[#f5a524]";
  }
  return "bg-[#3370ff]";
}

function renderFeishuInlineMarkdown(
  content: string,
  keyPrefix: string,
): ReactNode[] {
  return content.replaceAll("\r\n", "\n").split("\n").map((line, lineIndex) => {
    const segments = line.split(/(\*\*.*?\*\*)/g).filter(Boolean);

    return (
      <span
        key={`${keyPrefix}-line-${lineIndex}`}
        className={cn("block", lineIndex > 0 ? "mt-1.5" : "")}
      >
        {segments.length === 0 ? (
          <span className="inline-block h-5" />
        ) : (
          segments.map((segment, segmentIndex) => {
            const isBold =
              segment.startsWith("**") &&
              segment.endsWith("**") &&
              segment.length >= 4;
            const text = isBold ? segment.slice(2, -2) : segment;
            return (
              <span
                key={`${keyPrefix}-segment-${lineIndex}-${segmentIndex}`}
                className={isBold ? "font-semibold text-[#1f2329]" : undefined}
              >
                {text}
              </span>
            );
          })
        )}
      </span>
    );
  });
}

function FeishuMarkdownBlock({
  content,
  subdued = false,
}: {
  content: string;
  subdued?: boolean;
}) {
  const normalized = content.trim();
  const isQuote = normalized.startsWith("> ");
  const quoteText = isQuote
    ? normalized
        .split("\n")
        .map((line) => line.replace(/^>\s?/, ""))
        .join("\n")
    : normalized;

  return (
    <div
      className={cn(
        "text-[14px] leading-6 text-[#1f2329]",
        subdued ? "text-[12px] leading-5 text-[#8f959e]" : "",
      )}
    >
      {isQuote ? (
        <div className="rounded-xl border border-[#dce5ff] bg-[#f6f9ff] px-3.5 py-2.5 text-[#4e5969]">
          {renderFeishuInlineMarkdown(quoteText, `quote-${quoteText}`)}
        </div>
      ) : (
        renderFeishuInlineMarkdown(normalized, `text-${normalized}`)
      )}
    </div>
  );
}

function renderBasicBoldSegments(
  content: string,
  keyPrefix: string,
): ReactNode[] {
  return content
    .split(/(\*\*.*?\*\*)/g)
    .filter(Boolean)
    .map((segment, index) => {
      const isBold =
        segment.startsWith("**") &&
        segment.endsWith("**") &&
        segment.length >= 4;
      const text = isBold ? segment.slice(2, -2) : segment;
      return (
        <span
          key={`${keyPrefix}-${index}`}
          className={isBold ? "font-semibold text-[#1f2329]" : undefined}
        >
          {text}
        </span>
      );
    });
}

function decodeMarkdownTableCell(value: string): string {
  return value.replaceAll("\\|", "|").replaceAll("<br/>", "\n");
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "hr" }
  | { type: "table"; headers: string[]; rows: string[][] };

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|?$/.test(line.trim());
}

function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => decodeMarkdownTableCell(cell.trim()));
}

function parseMarkdownBlocks(body: string): MarkdownBlock[] {
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  const blocks: MarkdownBlock[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed === "---") {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        if (!current.startsWith("> ")) {
          break;
        }
        quoteLines.push(current.replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    if (
      trimmed.startsWith("|") &&
      index + 1 < lines.length &&
      isMarkdownTableSeparator(lines[index + 1])
    ) {
      const headers = parseMarkdownTableRow(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        if (!current.startsWith("|")) {
          break;
        }
        rows.push(parseMarkdownTableRow(current));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trimEnd();
      const currentTrimmed = current.trim();
      if (!currentTrimmed) {
        break;
      }
      if (
        currentTrimmed === "---" ||
        currentTrimmed.startsWith("> ") ||
        currentTrimmed.startsWith("|") ||
        /^(#{1,6})\s+/.test(currentTrimmed)
      ) {
        break;
      }
      paragraphLines.push(currentTrimmed);
      index += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraphLines });
      continue;
    }
    index += 1;
  }

  return blocks;
}

function MarkdownRenderedPreview({
  body,
}: {
  body: string;
}) {
  const blocks = useMemo(() => parseMarkdownBlocks(body), [body]);

  return (
    <div className="overflow-hidden rounded-[24px] border border-[#d7dde7] bg-white shadow-sm">
      <div className="border-b border-[#e5e6eb] bg-[#f7f8fa] px-5 py-4">
        <p className="text-base font-bold text-[#1f2329]">Markdown 预览</p>
        <p className="mt-1 text-sm text-[#646a73]">
          对应企业微信 / 钉钉发送时使用的 Markdown 内容。
        </p>
      </div>
      <div className="space-y-4 px-5 py-5">
        {blocks.map((block, blockIndex) => {
          if (block.type === "hr") {
            return <div key={`md-hr-${blockIndex}`} className="h-px bg-[#e5e6eb]" />;
          }

          if (block.type === "heading") {
            return (
              <div
                key={`md-heading-${blockIndex}`}
                className={cn(
                  "font-semibold text-[#1f2329]",
                  block.level <= 2 ? "text-[20px] leading-8" : "text-[16px] leading-6",
                )}
              >
                {renderBasicBoldSegments(block.text, `md-heading-${blockIndex}`)}
              </div>
            );
          }

          if (block.type === "quote") {
            return (
              <div
                key={`md-quote-${blockIndex}`}
                className="rounded-2xl border-l-4 border-[#99b2ff] bg-[#f5f8ff] px-4 py-3 text-[14px] leading-6 text-[#4e5969]"
              >
                {block.lines.map((line, lineIndex) => (
                  <div
                    key={`md-quote-line-${blockIndex}-${lineIndex}`}
                    className={lineIndex > 0 ? "mt-1.5" : undefined}
                  >
                    {renderBasicBoldSegments(line, `md-quote-${blockIndex}-${lineIndex}`)}
                  </div>
                ))}
              </div>
            );
          }

          if (block.type === "table") {
            return (
              <div
                key={`md-table-${blockIndex}`}
                className="overflow-hidden rounded-2xl border border-[#d7dde7]"
              >
                <div className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] bg-[#f7f8fa]">
                  {block.headers.map((header, headerIndex) => (
                    <div
                      key={`md-table-header-${blockIndex}-${headerIndex}`}
                      className="border-b border-[#e5e6eb] px-4 py-3 text-[12px] font-semibold text-[#4e5969]"
                    >
                      {header}
                    </div>
                  ))}
                </div>
                <div className="divide-y divide-[#e5e6eb]">
                  {block.rows.map((row, rowIndex) => (
                    <div
                      key={`md-table-row-${blockIndex}-${rowIndex}`}
                      className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)]"
                    >
                      {row.map((cell, cellIndex) => (
                        <div
                          key={`md-table-cell-${blockIndex}-${rowIndex}-${cellIndex}`}
                          className={cn(
                            "px-4 py-3 text-[14px] leading-6 text-[#1f2329]",
                            cellIndex === 0 ? "font-medium" : "text-[#4e5969]",
                          )}
                        >
                          {cell.split("\n").map((line, lineIndex) => (
                            <div
                              key={`md-table-cell-line-${blockIndex}-${rowIndex}-${cellIndex}-${lineIndex}`}
                              className={lineIndex > 0 ? "mt-1" : undefined}
                            >
                              {renderBasicBoldSegments(
                                line,
                                `md-table-${blockIndex}-${rowIndex}-${cellIndex}-${lineIndex}`,
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <div
              key={`md-paragraph-${blockIndex}`}
              className="text-[14px] leading-6 text-[#1f2329]"
            >
              {block.lines.map((line, lineIndex) => (
                <div
                  key={`md-line-${blockIndex}-${lineIndex}`}
                  className={lineIndex > 0 ? "mt-1.5" : undefined}
                >
                  {renderBasicBoldSegments(line, `md-line-${blockIndex}-${lineIndex}`)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTelegramHtmlForPreview(body: string): string[] {
  return body
    .replaceAll("\r\n", "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function TelegramHtmlPreview({
  body,
}: {
  body: string;
}) {
  const blocks = useMemo(() => formatTelegramHtmlForPreview(body), [body]);

  return (
    <div className="overflow-hidden rounded-[24px] border border-[#c7d7e8] bg-[#dbeafe] shadow-sm">
      <div className="border-b border-[#bfd4ec] bg-[#cfe4ff] px-5 py-4">
        <p className="text-base font-bold text-[#1f2329]">Telegram HTML 预览</p>
        <p className="mt-1 text-sm text-[#52606d]">
          对应 Telegram 发送时使用的 HTML 富文本内容。
        </p>
      </div>
      <div className="px-5 py-5">
        <div className="ml-auto max-w-[760px] rounded-[22px] rounded-br-md bg-white px-4 py-3 shadow-[0_10px_30px_rgba(37,99,235,0.12)]">
          <div className="space-y-3 text-[14px] leading-6 text-[#1f2329]">
            {blocks.map((block, blockIndex) =>
              block === "---" ? (
                <div key={`tg-hr-${blockIndex}`} className="h-px bg-[#e5e6eb]" />
              ) : (
                <div
                  key={`tg-block-${blockIndex}`}
                  className="break-words"
                  dangerouslySetInnerHTML={{
                    __html: block.replaceAll("\n", "<br />"),
                  }}
                />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeishuElementsPreview({
  message,
}: {
  message: PushStructuredMessage;
}) {
  const elements = renderFeishuElements(message);

  return (
    <div className="overflow-hidden rounded-[24px] border border-[#d7dde7] bg-white shadow-sm">
      <div className="border-b border-[#e5e6eb] bg-[#f7f8fa] px-5 py-4">
        <p className="text-base font-bold text-[#1f2329]">卡片元素预览</p>
        <p className="mt-1 text-sm text-[#646a73]">
          对应飞书发送时使用的交互式卡片内容。
        </p>
      </div>
      <div className="px-5 py-5">
        <div className="mx-auto w-full max-w-[760px] rounded-[28px] bg-[#eef2f7] p-5 sm:p-6">
          <div className="overflow-hidden rounded-[18px] border border-[#d7dde7] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
            <div
              className={cn(
                "px-5 py-4 text-white",
                getFeishuHeaderClassName(message.header.level),
              )}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-[18px] leading-none">
                  {message.header.icon ?? "🔔"}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[16px] font-semibold leading-6">
                    {message.header.title}
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              {elements.map((element, index) => {
                const tag = typeof element.tag === "string" ? element.tag : "";

                if (tag === "hr") {
                  return <div key={`hr-${index}`} className="h-px bg-[#e5e6eb]" />;
                }

                if (tag === "column_set") {
                  const columns = Array.isArray(element.columns)
                    ? (element.columns as Array<Record<string, unknown>>)
                    : [];
                  return (
                    <div
                      key={`column-set-${index}`}
                      className="grid gap-3 rounded-[14px] border border-[#e5e6eb] bg-[#fafbfc] p-3.5 md:grid-cols-2"
                    >
                      {columns.map((column, columnIndex) => {
                        const childElements = Array.isArray(column.elements)
                          ? (column.elements as Array<Record<string, unknown>>)
                          : [];
                        return (
                          <div
                            key={`column-${index}-${columnIndex}`}
                            className="space-y-1 rounded-xl bg-white px-3 py-2.5"
                          >
                            {childElements.map((child, childIndex) => (
                              <FeishuMarkdownBlock
                                key={`column-child-${index}-${columnIndex}-${childIndex}`}
                                content={getFeishuMarkdownContent(child)}
                              />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                const notation = element.text_size === "notation";
                return (
                  <div
                    key={`element-${index}`}
                    className={cn(
                      "rounded-[14px] px-1 py-0.5",
                      notation ? "" : "border border-transparent",
                    )}
                  >
                    <FeishuMarkdownBlock
                      content={getFeishuMarkdownContent(element)}
                      subdued={notation}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TextPreviewCard({
  title,
  description,
  body,
}: {
  title: string;
  description: string;
  body: string;
}) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-border/60 bg-gradient-to-br from-background via-background to-muted/20 shadow-sm">
      <div className="border-b border-border/50 bg-muted/20 px-5 py-4">
        <p className="text-base font-bold text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words px-5 py-5 text-sm leading-6 text-foreground/85">
        {body}
      </pre>
    </div>
  );
}

function PushRenderedPreview({
  record,
  mode,
  customTemplate,
}: {
  record: PushDeliveryRecord;
  mode: PreviewMode;
  customTemplate?: Record<string, unknown> | null;
}) {
  if (mode === "feishu") {
    return <FeishuElementsPreview message={record.message} />;
  }

  if (mode === "markdown") {
    return <MarkdownRenderedPreview body={getMarkdownText(record.message)} />;
  }

  if (mode === "telegram") {
    return <TelegramHtmlPreview body={getTelegramHtml(record.message)} />;
  }

  return (
    <TextPreviewCard
      title="自定义 JSON 预览"
      description={
        customTemplate
          ? "对应 custom webhook 模板渲染后的 JSON。"
          : "当前目标未配置自定义模板，这里展示系统标准结构。"
      }
      body={getCustomJsonText(record.message, customTemplate)}
    />
  );
}

export function PushManagementPanel({
  records,
  targets,
  tasks,
  onCreateTarget,
  onUpdateTarget,
  onDeleteTarget,
  onTestTarget,
  onSaveTask,
  onRefreshRecords,
}: PushManagementPanelProps) {
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [targetDialogMode, setTargetDialogMode] = useState<"create" | "edit">(
    "create",
  );
  const [editingTarget, setEditingTarget] = useState<PushTarget | null>(null);
  const [formValue, setFormValue] = useState<TargetFormValue>(DEFAULT_FORM);
  const [taskEditorType, setTaskEditorType] = useState<PushTaskType | null>(
    null,
  );
  const [taskEditorEnabled, setTaskEditorEnabled] = useState(false);
  const [taskEditorTargetIds, setTaskEditorTargetIds] = useState<string[]>([]);
  const [savingTarget, setSavingTarget] = useState(false);
  const [deletingTargetId, setDeletingTargetId] = useState<string | null>(null);
  const [testingTargetId, setTestingTargetId] = useState<string | null>(null);
  const [togglingTargetId, setTogglingTargetId] = useState<string | null>(null);
  const [savingTaskType, setSavingTaskType] = useState<PushTaskType | null>(
    null,
  );
  const [previewingRecordId, setPreviewingRecordId] = useState<string | null>(
    null,
  );
  const [previewMode, setPreviewMode] = useState<PreviewMode>("feishu");
  const [refreshingRecords, setRefreshingRecords] = useState(false);
  const [testTemplateByTargetId, setTestTemplateByTargetId] = useState<
    Record<string, PushTestTemplateType>
  >({});

  const enabledTargets = useMemo(
    () => targets.filter((target) => target.isEnabled),
    [targets],
  );
  const enabledTasks = useMemo(
    () => tasks.filter((task) => task.enabled),
    [tasks],
  );
  const latestSuccessfulTestAt = useMemo(
    () =>
      targets
        .filter((target) => target.lastTestResult?.success && target.lastTestAt)
        .map((target) => target.lastTestAt as string)
        .sort((left, right) => right.localeCompare(left))[0] ?? null,
    [targets],
  );
  const taskMap = useMemo(
    () => new Map(tasks.map((task) => [task.taskType, task])),
    [tasks],
  );
  const latestRecordAt = useMemo(
    () =>
      records
        .map((record) => record.sentAt)
        .sort((a, b) => b.localeCompare(a))[0] ?? null,
    [records],
  );
  const previewingRecord = useMemo(
    () => records.find((record) => record.id === previewingRecordId) ?? null,
    [records, previewingRecordId],
  );
  const previewingTarget = useMemo(
    () =>
      previewingRecord
        ? (targets.find((target) => target.id === previewingRecord.targetId) ??
          null)
        : null,
    [previewingRecord, targets],
  );

  useEffect(() => {
    if (!targetDialogOpen) {
      setFormValue(buildFormValue(editingTarget ?? undefined));
    }
  }, [editingTarget, targetDialogOpen]);

  const openCreateDialog = () => {
    setTargetDialogMode("create");
    setEditingTarget(null);
    setFormValue(DEFAULT_FORM);
    setTargetDialogOpen(true);
  };

  const openEditDialog = (target: PushTarget) => {
    setTargetDialogMode("edit");
    setEditingTarget(target);
    setFormValue(buildFormValue(target));
    setTargetDialogOpen(true);
  };

  const openTaskEditor = (taskType: PushTaskType) => {
    const task = taskMap.get(taskType);
    setTaskEditorType(taskType);
    setTaskEditorEnabled(task?.enabled ?? false);
    setTaskEditorTargetIds(task?.targetIds ?? []);
  };

  const closeTaskEditor = () => {
    setTaskEditorType(null);
    setTaskEditorEnabled(false);
    setTaskEditorTargetIds([]);
  };

  const handleSaveTarget = async () => {
    setSavingTarget(true);
    try {
      const payload = buildTargetSubmitPayload(formValue);
      const result =
        targetDialogMode === "create"
          ? await onCreateTarget(payload)
          : await onUpdateTarget(editingTarget?.id ?? "", payload);
      if (!result.ok) {
        return;
      }
      setTargetDialogOpen(false);
    } finally {
      setSavingTarget(false);
    }
  };

  const handleDeleteTarget = async (targetId: string) => {
    setDeletingTargetId(targetId);
    try {
      await onDeleteTarget(targetId);
    } finally {
      setDeletingTargetId(null);
    }
  };

  const handleTestTarget = async (targetId: string) => {
    setTestingTargetId(targetId);
    try {
      await onTestTarget(
        targetId,
        testTemplateByTargetId[targetId] ?? "push_test",
      );
    } finally {
      setTestingTargetId(null);
    }
  };

  const handleToggleTargetEnabled = async (target: PushTarget) => {
    setTogglingTargetId(target.id);
    try {
      await onUpdateTarget(target.id, {
        name: target.name,
        providerType: target.providerType,
        webhookUrl: target.webhookUrl,
        telegramBotToken: target.telegramBotToken,
        telegramChatId: target.telegramChatId,
        dingtalkSecret: target.dingtalkSecret,
        customHeaders: target.customHeaders,
        customTemplate: target.customTemplate,
        isEnabled: !target.isEnabled,
      });
    } finally {
      setTogglingTargetId(null);
    }
  };

  const handleSaveTask = async () => {
    if (!taskEditorType) {
      return;
    }
    setSavingTaskType(taskEditorType);
    try {
      const result = await onSaveTask(taskEditorType, {
        enabled: taskEditorEnabled,
        targetIds: taskEditorTargetIds,
      });
      if (!result.ok) {
        return;
      }
      closeTaskEditor();
    } finally {
      setSavingTaskType(null);
    }
  };

  const handleRefreshRecords = async () => {
    setRefreshingRecords(true);
    try {
      await onRefreshRecords();
    } finally {
      setRefreshingRecords(false);
    }
  };

  const handleToggleTaskTarget = (target: PushTarget) => {
    const checked = taskEditorTargetIds.includes(target.id);
    setTaskEditorTargetIds((current) =>
      checked
        ? current.filter((item) => item !== target.id)
        : [...current, target.id],
    );

    if (!checked && !target.isEnabled) {
      toast.warning(
        "目标当前不会发送",
        "目标已选中但当前不会发送，推送目标管理中启用后才会参与推送。",
      );
    }
  };

  return (
    <div className="grid gap-8">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-indigo-500/15 bg-gradient-to-br from-indigo-500/8 via-background to-background">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/12 text-indigo-600">
              <Webhook className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">
                已启用目标
              </p>
              <div className="flex min-h-8 items-center">
                <p className="text-2xl font-extrabold leading-none text-foreground">
                  {enabledTargets.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-sky-500/15 bg-gradient-to-br from-sky-500/8 via-background to-background">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-600">
              <Bell className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">
                已启用任务
              </p>
              <div className="flex min-h-8 items-center">
                <p className="text-2xl font-extrabold leading-none text-foreground">
                  {enabledTasks.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/15 bg-gradient-to-br from-emerald-500/8 via-background to-background">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">
                最近成功测试
              </p>
              <div className="flex min-h-8 items-center">
                <p className="text-sm font-bold leading-tight text-foreground">
                  {latestSuccessfulTestAt
                    ? formatDateTime(latestSuccessfulTestAt)
                    : "暂无成功记录"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden border-border/40 shadow-xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b bg-muted/20 p-6">
          <div className="space-y-1">
            <h3 className="text-lg font-bold tracking-tight text-foreground">
              推送目标管理
            </h3>
            <p className="text-sm text-muted-foreground">
              配置企业微信、飞书、钉钉、Telegram 和自定义 Webhook
              目标，并执行联调测试。
            </p>
          </div>
          <Button
            type="button"
            onClick={openCreateDialog}
            className="rounded-xl font-bold"
          >
            <Plus className="h-4 w-4" />
            新增目标
          </Button>
        </div>
        <CardContent className="grid gap-4 bg-background/30 p-6">
          {targets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-center text-sm text-muted-foreground">
              暂未配置任何推送目标。
            </div>
          ) : (
            targets.map((target) => (
              <div
                key={target.id}
                className="rounded-2xl border border-border/50 bg-card/50 p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-bold text-foreground">
                        {target.name}
                      </p>
                      <TargetProviderBadge providerType={target.providerType} />
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold",
                          target.isEnabled
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {target.isEnabled ? "已启用" : "已停用"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      最近测试：{" "}
                      {target.lastTestResult
                        ? `${formatDateTime(target.lastTestAt)} · ${target.lastTestResult.success ? "成功" : "失败"}${typeof target.lastTestResult.latencyMs === "number" ? ` · ${target.lastTestResult.latencyMs} ms` : ""}${!target.lastTestResult.success && target.lastTestResult.error ? ` · ${target.lastTestResult.error}` : ""}`
                        : "未测试"}
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 xl:w-auto xl:min-w-[360px] xl:items-end">
                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/50 bg-muted/15 p-2 xl:justify-end">
                      <Select
                        value={testTemplateByTargetId[target.id] ?? "push_test"}
                        onValueChange={(value) =>
                          setTestTemplateByTargetId((current) => ({
                            ...current,
                            [target.id]: value as PushTestTemplateType,
                          }))
                        }
                      >
                        <SelectTrigger className="h-9 min-w-0 flex-1 rounded-xl border-border/60 bg-background px-3 text-xs font-medium focus:ring-primary/20 sm:min-w-[188px]">
                          <SelectValue placeholder="选择测试类型">
                            {getPushTestTemplateLabel(
                              testTemplateByTargetId[target.id] ?? "push_test",
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-border/40 shadow-xl">
                          <SelectItem
                            value="push_test"
                            className="rounded-lg text-xs font-medium"
                          >
                            通用测试消息
                          </SelectItem>
                          {tasks.map((task) => (
                            <SelectItem
                              key={task.taskType}
                              value={task.taskType}
                              className="rounded-lg text-xs font-medium"
                            >
                              {getPushTaskLabel(task.taskType)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>{" "}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleTestTarget(target.id)}
                        disabled={testingTargetId === target.id}
                        className="h-9 rounded-xl bg-background px-4"
                      >
                        {testingTargetId === target.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <TestTube2 className="h-4 w-4" />
                        )}
                        测试
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <div className="inline-flex h-9 items-center rounded-xl border border-border/50 bg-background px-3">
                        <MiniSwitch
                          checked={target.isEnabled}
                          onCheckedChange={() => {
                            void handleToggleTargetEnabled(target);
                          }}
                          label={`${target.isEnabled ? "禁用" : "启用"}推送目标`}
                          disabled={togglingTargetId === target.id}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openEditDialog(target)}
                        className="h-9 rounded-xl bg-background px-4"
                      >
                        <Edit3 className="h-4 w-4" />
                        编辑
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteTarget(target.id)}
                        disabled={deletingTargetId === target.id}
                        className="h-9 rounded-xl border-rose-200 bg-rose-50/80 px-4 text-rose-600 hover:border-rose-300 hover:bg-rose-100/80 hover:text-rose-700"
                      >
                        {deletingTargetId === target.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        删除
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/40 shadow-xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b bg-muted/20 p-6">
          <div className="space-y-1">
            <h3 className="text-lg font-bold tracking-tight text-foreground">
              推送任务管理
            </h3>
            <p className="text-sm text-muted-foreground">
              管理签到与定时自动刷新相关推送任务的启停状态、目标绑定和触发范围。
            </p>
          </div>
        </div>
        <CardContent className="grid gap-4 bg-background/30 p-6 xl:grid-cols-2">
          {tasks.map((task) => {
            const boundTargets = targets.filter((target) =>
              task.targetIds.includes(target.id),
            );
            return (
              <div
                key={task.taskType}
                className="rounded-2xl border border-border/50 bg-card/50 p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex h-9 w-9 items-center justify-center rounded-xl",
                          getTaskIconClassName(task.taskType),
                        )}
                      >
                        {getTaskIcon(task.taskType)}
                      </span>
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-bold text-foreground">
                          {getPushTaskLabel(task.taskType)}
                        </p>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {getTaskDescription(task.taskType)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold",
                          task.enabled
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {task.enabled ? "已启用" : "已停用"}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-muted/50 px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                        已选择目标 {boundTargets.length}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openTaskEditor(task.taskType)}
                    className="self-start rounded-xl"
                  >
                    <Edit3 className="h-4 w-4" />
                    编辑绑定
                  </Button>
                </div>
                <div className="mt-4 flex min-h-7 flex-wrap items-center gap-2">
                  {boundTargets.length > 0 ? (
                    boundTargets.map((target) => (
                      <span
                        key={target.id}
                        className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-background/70 px-2.5 py-1 text-[11px] font-bold text-foreground/80"
                      >
                        {getPushProviderLabel(target.providerType)}
                        <span className="text-muted-foreground">·</span>
                        {target.name}
                        {!target.isEnabled ? (
                          <span className="ml-1 inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200/80">
                            已禁用
                          </span>
                        ) : null}
                      </span>
                    ))
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-dashed border-border/50 bg-background/50 px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                      尚未选择推送目标
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-border/40 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col gap-4 border-b bg-muted/20 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <History className="h-4 w-4" />
              </span>
              <h3 className="text-lg font-bold tracking-tight text-foreground">
                推送记录
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">
              保留最近 50
              条推送记录，可查看时间、任务类型、目标和当时的消息预览。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-border/50 bg-background/70 px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
              最近记录：
              {latestRecordAt ? formatDateTime(latestRecordAt) : "暂无"}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRefreshRecords}
              disabled={refreshingRecords}
              className="rounded-xl bg-background"
            >
              {refreshingRecords ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              刷新记录
            </Button>
          </div>
        </div>
        <CardContent className="grid gap-4 bg-background/30 p-6">
          {records.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 text-center text-sm text-muted-foreground">
              暂无推送记录。
            </div>
          ) : (
            records.map((record) => {
              return (
                <div
                  key={record.id}
                  className="rounded-2xl border border-border/50 bg-card/50 p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-3">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold",
                            record.success
                              ? "bg-emerald-500/10 text-emerald-600"
                              : "bg-rose-500/10 text-rose-600",
                          )}
                        >
                          {record.success ? "发送成功" : "发送失败"}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-muted/50 px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                          {record.source === "test" ? "测试推送" : "任务推送"}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-border/50 bg-background/80 px-2.5 py-1 text-[11px] font-bold text-foreground/80">
                          {getRecordTypeLabel(record)}
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(210px,1.6fr)_minmax(250px,2fr)_minmax(118px,0.85fr)]">
                        <div className="min-w-0 rounded-2xl border border-border/50 bg-background/70 px-3 py-2">
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                            推送时间
                          </p>
                          <p
                            className="mt-1 truncate text-[13px] font-semibold text-foreground sm:text-sm"
                            title={formatDateTime(record.sentAt)}
                          >
                            {formatDateTime(record.sentAt)}
                          </p>
                        </div>
                        <div className="min-w-0 rounded-2xl border border-border/50 bg-background/70 px-3 py-2">
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                            推送目标
                          </p>
                          <p
                            className="mt-1 truncate text-sm font-semibold text-foreground"
                            title={record.targetName}
                          >
                            {record.targetName}
                          </p>
                        </div>
                        <div className="min-w-0 rounded-2xl border border-border/50 bg-background/70 px-3 py-2">
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                            推送渠道
                          </p>
                          <p className="mt-1 truncate text-sm font-semibold text-foreground">
                            {getPushProviderLabel(record.targetProviderType)}
                          </p>
                        </div>
                      </div>
                      {!record.success && record.error ? (
                        <div className="rounded-2xl border border-rose-200/70 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
                          {record.error}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex w-full flex-col gap-2 lg:w-[112px] lg:shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPreviewMode(
                            getDefaultPreviewMode(record.targetProviderType),
                          );
                          setPreviewingRecordId(record.id);
                        }}
                        className="h-7 self-end rounded-lg bg-background px-2 text-[11px]"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        预览
                      </Button>
                      <div className="min-w-0 rounded-2xl border border-border/50 bg-background/70 px-3 py-2">
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                          延迟
                        </p>
                        <p className="mt-1 truncate text-sm font-semibold text-foreground">
                          {typeof record.latencyMs === "number"
                            ? `${record.latencyMs} ms`
                            : "未记录"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {previewingRecord ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          onClick={() => setPreviewingRecordId(null)}
        >
          <div
            className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-border/50 bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border/50 px-6 py-5">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-foreground">
                  推送内容预览
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center rounded-full border border-border/50 bg-background/80 px-2.5 py-1 font-bold text-foreground/80">
                    {getRecordTypeLabel(previewingRecord)}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-border/50 bg-background/80 px-2.5 py-1 font-bold">
                    {getPushProviderLabel(previewingRecord.targetProviderType)}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-border/50 bg-background/80 px-2.5 py-1 font-bold">
                    {previewingRecord.targetName}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-border/50 bg-background/80 px-2.5 py-1 font-bold">
                    {formatDateTime(previewingRecord.sentAt)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewingRecordId(null)}
                className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="border-b border-border/50 px-6 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {PREVIEW_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPreviewMode(option.id)}
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
                      previewMode === option.id
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/50 bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-y-auto px-6 py-6">
              <PushRenderedPreview
                record={previewingRecord}
                mode={previewMode}
                customTemplate={previewingTarget?.customTemplate ?? null}
              />
            </div>
          </div>
        </div>
      ) : null}

      {targetDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-3xl border border-border/50 bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/50 px-6 py-5">
              <div>
                <h3 className="text-lg font-bold text-foreground">
                  {targetDialogMode === "create"
                    ? "新增推送目标"
                    : "编辑推送目标"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  按渠道填写对应凭证或 Webhook 地址，自定义 Webhook
                  可选填模板和请求头。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTargetDialogOpen(false)}
                className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-5 px-6 py-6 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-foreground">
                目标名称
                <input
                  value={formValue.name}
                  onChange={(event) =>
                    setFormValue((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  className="h-11 rounded-xl border border-border/60 bg-background px-4 text-sm outline-none transition focus:border-primary"
                  placeholder="例如：飞书运维群"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-foreground">
                推送渠道
                <Select
                  value={formValue.providerType}
                  onValueChange={(value) =>
                    setFormValue((current) => ({
                      ...current,
                      providerType: value as PushProviderType,
                    }))
                  }
                >
                  <SelectTrigger className="h-11 w-full rounded-xl border-border/60 bg-background px-4 text-sm focus:ring-primary/20 data-[size=default]:h-11">
                    <SelectValue placeholder="选择推送渠道" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-border/40 shadow-xl">
                    <SelectItem value="wechat" className="rounded-lg">
                      企业微信
                    </SelectItem>
                    <SelectItem value="feishu" className="rounded-lg">
                      飞书
                    </SelectItem>
                    <SelectItem value="dingtalk" className="rounded-lg">
                      钉钉
                    </SelectItem>
                    <SelectItem value="telegram" className="rounded-lg">
                      Telegram
                    </SelectItem>
                    <SelectItem value="custom" className="rounded-lg">
                      自定义 Webhook
                    </SelectItem>
                  </SelectContent>
                </Select>
              </label>

              {formValue.providerType !== "telegram" && (
                <label className="grid gap-2 text-sm font-medium text-foreground md:col-span-2">
                  Webhook URL
                  <input
                    value={formValue.webhookUrl}
                    onChange={(event) =>
                      setFormValue((current) => ({
                        ...current,
                        webhookUrl: event.target.value,
                      }))
                    }
                    className="h-11 rounded-xl border border-border/60 bg-background px-4 text-sm outline-none transition focus:border-primary"
                    placeholder="https://..."
                  />
                </label>
              )}

              {formValue.providerType === "telegram" && (
                <>
                  <label className="grid gap-2 text-sm font-medium text-foreground">
                    Bot Token
                    <input
                      value={formValue.telegramBotToken}
                      onChange={(event) =>
                        setFormValue((current) => ({
                          ...current,
                          telegramBotToken: event.target.value,
                        }))
                      }
                      className="h-11 rounded-xl border border-border/60 bg-background px-4 text-sm outline-none transition focus:border-primary"
                      placeholder="123456:ABC..."
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-foreground">
                    Chat ID
                    <input
                      value={formValue.telegramChatId}
                      onChange={(event) =>
                        setFormValue((current) => ({
                          ...current,
                          telegramChatId: event.target.value,
                        }))
                      }
                      className="h-11 rounded-xl border border-border/60 bg-background px-4 text-sm outline-none transition focus:border-primary"
                      placeholder="-100..."
                    />
                  </label>
                </>
              )}

              {formValue.providerType === "dingtalk" && (
                <label className="grid gap-2 text-sm font-medium text-foreground md:col-span-2">
                  签名 Secret
                  <input
                    value={formValue.dingtalkSecret}
                    onChange={(event) =>
                      setFormValue((current) => ({
                        ...current,
                        dingtalkSecret: event.target.value,
                      }))
                    }
                    className="h-11 rounded-xl border border-border/60 bg-background px-4 text-sm outline-none transition focus:border-primary"
                    placeholder="选填：开启加签时填写"
                  />
                </label>
              )}

              {formValue.providerType === "custom" && (
                <>
                  <label className="grid gap-2 text-sm font-medium text-foreground">
                    自定义请求头
                    <textarea
                      rows={8}
                      value={formValue.customHeaders}
                      onChange={(event) =>
                        setFormValue((current) => ({
                          ...current,
                          customHeaders: event.target.value,
                        }))
                      }
                      className="rounded-2xl border border-border/60 bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                      placeholder={`{\n  "Authorization": "Bearer xxx"\n}`}
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-foreground">
                    自定义模板
                    <textarea
                      rows={8}
                      value={formValue.customTemplate}
                      onChange={(event) =>
                        setFormValue((current) => ({
                          ...current,
                          customTemplate: event.target.value,
                        }))
                      }
                      className="rounded-2xl border border-border/60 bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                      placeholder={`{\n  "title": "{{title}}",\n  "task": "{{taskType}}"\n}`}
                    />
                  </label>
                </>
              )}

              <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-muted/15 px-4 py-3 md:col-span-2">
                <div>
                  <p className="text-sm font-bold text-foreground">启用目标</p>
                  <p className="text-xs text-muted-foreground">
                    停用后不会接收任何业务推送，但配置会被保留。
                  </p>
                </div>
                <MiniSwitch
                  checked={formValue.isEnabled}
                  onCheckedChange={(checked) =>
                    setFormValue((current) => ({
                      ...current,
                      isEnabled: checked,
                    }))
                  }
                  label="启用推送目标"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border/50 px-6 py-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTargetDialogOpen(false)}
                className="rounded-xl"
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={handleSaveTarget}
                disabled={savingTarget}
                className="rounded-xl font-bold"
              >
                {savingTarget ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

      {taskEditorType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-border/50 bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/50 px-6 py-5">
              <div>
                <h3 className="text-lg font-bold text-foreground">
                  编辑任务绑定
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {getPushTaskLabel(taskEditorType)}{" "}
                  {getTaskTriggerSummary(taskEditorType)}。
                </p>
              </div>
              <button
                type="button"
                onClick={closeTaskEditor}
                className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid gap-5 px-6 py-6">
              <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-muted/15 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-foreground">启用任务</p>
                  <p className="text-xs text-muted-foreground">
                    关闭后即使已绑定目标，也不会推送这类消息。
                  </p>
                </div>
                <MiniSwitch
                  checked={taskEditorEnabled}
                  onCheckedChange={setTaskEditorEnabled}
                  label="启用推送任务"
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-bold text-foreground">绑定目标</p>
                </div>
                {targets.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-5 text-sm text-muted-foreground">
                    当前还没有推送目标，请先在“推送目标管理”中创建目标。
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {targets.map((target) => {
                      const checked = taskEditorTargetIds.includes(target.id);
                      return (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() => handleToggleTaskTarget(target)}
                          className={cn(
                            "flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors",
                            checked
                              ? "border-primary/40 bg-primary/5"
                              : "border-border/50 bg-card/40 hover:bg-muted/20",
                          )}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold text-foreground">
                                {target.name}
                              </p>
                              <TargetProviderBadge
                                providerType={target.providerType}
                              />
                              {!target.isEnabled ? (
                                <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200/80">
                                  已禁用
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <span
                            className={cn(
                              "inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-[11px] font-bold",
                              checked
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border/60 bg-background/60 text-muted-foreground",
                            )}
                          >
                            {checked ? "已选" : "未选"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border/50 px-6 py-5">
              <Button
                type="button"
                variant="outline"
                onClick={closeTaskEditor}
                className="rounded-xl"
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={handleSaveTask}
                disabled={savingTaskType === taskEditorType}
                className="rounded-xl font-bold"
              >
                {savingTaskType === taskEditorType ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                保存绑定
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
