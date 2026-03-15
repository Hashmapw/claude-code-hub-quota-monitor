import type {
  PushProviderType,
  PushStructuredMessage,
  PushTarget,
} from "@/lib/push/types";

export type PushRenderedPayload = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

export type PushPreviewPayload =
  | { kind: "feishu-card" }
  | { kind: "markdown"; body: string }
  | { kind: "telegram-html"; body: string }
  | { kind: "custom-json"; body: string; note: string };

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function escapeMarkdownTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br/>");
}

function renderMarkdownTable(
  lines: string[],
  columns: [string, string],
  rows: Array<{ left: string; right: string }>,
): void {
  lines.push(
    `| ${escapeMarkdownTableCell(columns[0])} | ${escapeMarkdownTableCell(columns[1])} |`,
  );
  lines.push("| --- | --- |");
  for (const row of rows) {
    lines.push(
      `| ${escapeMarkdownTableCell(row.left)} | ${escapeMarkdownTableCell(row.right)} |`,
    );
  }
}

export function renderMarkdownBody(message: PushStructuredMessage): string[] {
  const lines: string[] = [];

  const icon = message.header.icon ? `${message.header.icon} ` : "";
  lines.push(`## ${icon}${message.header.title}`);
  lines.push("");

  if (message.summary) {
    lines.push(message.summary);
    lines.push("");
  }

  for (const section of message.sections) {
    if (section.title) {
      lines.push(`**${section.title}**`);
    }

    for (const content of section.content) {
      if (content.type === "text") {
        lines.push(content.value);
        continue;
      }
      if (content.type === "quote") {
        lines.push(`> ${content.value}`);
        continue;
      }
      if (content.type === "divider") {
        lines.push("---");
        continue;
      }
      if (content.type === "fields") {
        for (const item of content.items) {
          lines.push(`${item.label}: ${item.value}`);
        }
        continue;
      }
      if (content.type === "table") {
        renderMarkdownTable(lines, content.columns, content.rows);
        continue;
      }
      for (const item of content.items) {
        const prefix = item.icon ? `${item.icon} ` : "- ";
        lines.push(`${prefix}**${item.primary}**`);
        if (item.secondary) {
          lines.push(item.secondary);
        }
      }
    }

    lines.push("");
  }

  if (message.footer && message.footer.length > 0) {
    lines.push("---");
    for (const section of message.footer) {
      if (section.title) {
        lines.push(`**${section.title}**`);
      }
      for (const content of section.content) {
        if (content.type === "text") {
          lines.push(content.value);
        } else if (content.type === "quote") {
          lines.push(`> ${content.value}`);
        } else if (content.type === "divider") {
          lines.push("---");
        } else if (content.type === "fields") {
          for (const item of content.items) {
            lines.push(`${item.label}: ${item.value}`);
          }
        } else if (content.type === "table") {
          renderMarkdownTable(lines, content.columns, content.rows);
        } else {
          for (const item of content.items) {
            const prefix = item.icon ? `${item.icon} ` : "- ";
            lines.push(`${prefix}**${item.primary}**`);
            if (item.secondary) {
              lines.push(item.secondary);
            }
          }
        }
      }
      lines.push("");
    }
  }

  lines.push(formatTimestamp(message.timestamp));
  return lines;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderTelegramBody(message: PushStructuredMessage): string {
  const lines: string[] = [];
  lines.push(`<b>${escapeHtml(message.header.title)}</b>`);
  lines.push("");

  if (message.summary) {
    lines.push(escapeHtml(message.summary));
    lines.push("");
  }

  for (const section of message.sections) {
    if (section.title) {
      lines.push(`<b>${escapeHtml(section.title)}</b>`);
    }

    for (const content of section.content) {
      if (content.type === "text") {
        lines.push(escapeHtml(content.value));
      } else if (content.type === "quote") {
        lines.push(`&gt; ${escapeHtml(content.value)}`);
      } else if (content.type === "divider") {
        lines.push("---");
      } else if (content.type === "fields") {
        for (const item of content.items) {
          lines.push(
            `<b>${escapeHtml(item.label)}</b>: ${escapeHtml(item.value)}`,
          );
        }
      } else if (content.type === "table") {
        lines.push(
          `<b>${escapeHtml(content.columns[0])}</b> | <b>${escapeHtml(content.columns[1])}</b>`,
        );
        for (const row of content.rows) {
          lines.push("");
          lines.push(`<b>${escapeHtml(row.left)}</b>`);
          lines.push(escapeHtml(row.right));
        }
      } else {
        for (const item of content.items) {
          lines.push(`- <b>${escapeHtml(item.primary)}</b>`);
          if (item.secondary) {
            lines.push(escapeHtml(item.secondary));
          }
        }
      }
    }

    lines.push("");
  }

  lines.push(escapeHtml(formatTimestamp(message.timestamp)));
  return lines.join("\n").trim();
}

function renderFeishuTableElements(
  columns: [string, string],
  rows: Array<{ left: string; right: string }>,
): Array<Record<string, unknown>> {
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "column_set",
      flex_mode: "bisect",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [
            {
              tag: "markdown",
              content: `**${columns[0]}**`,
            },
          ],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 3,
          elements: [
            {
              tag: "markdown",
              content: `**${columns[1]}**`,
            },
          ],
        },
      ],
    },
  ];

  for (const row of rows) {
    elements.push({
      tag: "column_set",
      flex_mode: "bisect",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [
            {
              tag: "markdown",
              content: row.left,
            },
          ],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 3,
          elements: [
            {
              tag: "markdown",
              content: row.right,
            },
          ],
        },
      ],
    });
  }

  return elements;
}

export function renderFeishuElements(
  message: PushStructuredMessage,
): Array<Record<string, unknown>> {
  const elements: Array<Record<string, unknown>> = [];

  if (message.summary) {
    elements.push({
      tag: "markdown",
      content: message.summary,
    });
  }

  for (const section of message.sections) {
    if (section.title) {
      elements.push({
        tag: "markdown",
        content: `**${section.title}**`,
      });
    }

    for (const content of section.content) {
      if (content.type === "text") {
        elements.push({ tag: "markdown", content: content.value });
      } else if (content.type === "quote") {
        elements.push({ tag: "markdown", content: `> ${content.value}` });
      } else if (content.type === "divider") {
        elements.push({ tag: "hr" });
      } else if (content.type === "fields") {
        const columns = content.items.map((item) => ({
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [
            {
              tag: "markdown",
              content: `**${item.label}**\n${item.value}`,
            },
          ],
        }));

        for (let i = 0; i < columns.length; i += 2) {
          elements.push({
            tag: "column_set",
            flex_mode: "bisect",
            columns: columns.slice(i, i + 2),
          });
        }
      } else if (content.type === "table") {
        elements.push(
          ...renderFeishuTableElements(content.columns, content.rows),
        );
      } else {
        elements.push({
          tag: "markdown",
          content: content.items
            .map((item) => {
              const icon = item.icon ? `${item.icon} ` : "";
              return `${icon}**${item.primary}**${item.secondary ? `\n${item.secondary}` : ""}`;
            })
            .join("\n\n"),
        });
      }
    }
  }

  elements.push({ tag: "hr" });
  elements.push({
    tag: "markdown",
    content: formatTimestamp(message.timestamp),
    text_size: "notation",
  });

  return elements;
}

export function buildCanonicalPayload(
  message: PushStructuredMessage,
): Record<string, unknown> {
  return {
    title: message.header.title,
    level: message.header.level,
    taskType: message.metadata?.taskType ?? null,
    timestamp: message.timestamp,
    summary: message.summary ?? null,
    sections: message.sections,
    metadata: message.metadata ?? {},
  };
}

export function renderPushPreviewPayload(
  providerType: PushProviderType,
  message: PushStructuredMessage,
): PushPreviewPayload {
  if (providerType === "wechat" || providerType === "dingtalk") {
    return {
      kind: "markdown",
      body: renderMarkdownBody(message).join("\n").trim(),
    };
  }

  if (providerType === "telegram") {
    return {
      kind: "telegram-html",
      body: renderTelegramBody(message),
    };
  }

  if (providerType === "custom") {
    return {
      kind: "custom-json",
      body: JSON.stringify(buildCanonicalPayload(message), null, 2),
      note: "自定义 Webhook 的最终 payload 可能会受目标模板影响，这里展示的是系统标准结构。",
    };
  }

  return { kind: "feishu-card" };
}

function resolveTemplatePath(data: unknown, path: string): unknown {
  return path
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<unknown>((current, key) => {
      if (Array.isArray(current)) {
        const index = Number(key);
        if (!Number.isInteger(index)) {
          return undefined;
        }
        return current[index];
      }
      if (current && typeof current === "object") {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, data);
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function applyTemplateValue(
  template: unknown,
  data: Record<string, unknown>,
): unknown {
  if (Array.isArray(template)) {
    return template.map((item) => applyTemplateValue(item, data));
  }

  if (template && typeof template === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      template as Record<string, unknown>,
    )) {
      next[key] = applyTemplateValue(value, data);
    }
    return next;
  }

  if (typeof template !== "string") {
    return template;
  }

  const fullMatch = template.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (fullMatch) {
    const resolved = resolveTemplatePath(data, fullMatch[1]);
    if (resolved === undefined) {
      throw new Error(`自定义模板引用了不存在的字段: ${fullMatch[1]}`);
    }
    return resolved;
  }

  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, rawPath: string) => {
    const resolved = resolveTemplatePath(data, rawPath);
    if (resolved === undefined) {
      throw new Error(`自定义模板引用了不存在的字段: ${rawPath}`);
    }
    return stringifyTemplateValue(resolved);
  });
}

function renderCustomPayload(
  target: PushTarget,
  message: PushStructuredMessage,
): PushRenderedPayload {
  const canonical = buildCanonicalPayload(message);
  const bodyData = target.customTemplate
    ? (applyTemplateValue(target.customTemplate, canonical) as Record<
        string,
        unknown
      >)
    : canonical;

  return {
    url: target.webhookUrl ?? "",
    headers: {
      ...(target.customHeaders ?? {}),
    },
    body: JSON.stringify(bodyData),
  };
}

function resolveTargetUrl(target: PushTarget): string {
  if (target.providerType === "telegram") {
    const token = target.telegramBotToken?.trim();
    if (!token) {
      throw new Error("Telegram Bot Token 不能为空");
    }
    return `https://api.telegram.org/bot${token}/sendMessage`;
  }

  const webhookUrl = target.webhookUrl?.trim();
  if (!webhookUrl) {
    throw new Error("Webhook URL 不能为空");
  }
  return webhookUrl;
}

function renderMarkdownPayload(
  providerType: Extract<PushProviderType, "wechat" | "dingtalk">,
  target: PushTarget,
  message: PushStructuredMessage,
): PushRenderedPayload {
  const markdown = renderMarkdownBody(message).join("\n").trim();
  if (providerType === "wechat") {
    return {
      url: resolveTargetUrl(target),
      headers: {},
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: { content: markdown },
      }),
    };
  }

  return {
    url: resolveTargetUrl(target),
    headers: {},
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: {
        title: message.header.title,
        text: markdown,
      },
    }),
  };
}

export function renderPushPayload(
  target: PushTarget,
  message: PushStructuredMessage,
): PushRenderedPayload {
  if (target.providerType === "custom") {
    return renderCustomPayload(target, message);
  }

  if (target.providerType === "wechat" || target.providerType === "dingtalk") {
    return renderMarkdownPayload(target.providerType, target, message);
  }

  if (target.providerType === "telegram") {
    return {
      url: resolveTargetUrl(target),
      headers: {},
      body: JSON.stringify({
        chat_id: target.telegramChatId,
        text: renderTelegramBody(message),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    };
  }

  return {
    url: resolveTargetUrl(target),
    headers: {},
    body: JSON.stringify({
      msg_type: "interactive",
      card: {
        schema: "2.0",
        header: {
          title: {
            tag: "plain_text",
            content: `${message.header.icon ? `${message.header.icon} ` : ""}${message.header.title}`,
          },
          template:
            message.header.level === "error"
              ? "red"
              : message.header.level === "warning"
                ? "orange"
                : "blue",
        },
        body: {
          elements: renderFeishuElements(message),
        },
      },
    }),
  };
}
