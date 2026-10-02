export interface ToolText {
  isError: boolean;
  /** The "Scope: …" line every answer starts with (undefined when there is none). */
  scope: string | undefined;
  /** The text parts after the scope line. */
  texts: string[];
  data: Record<string, unknown> | undefined;
}

/** A tool result split into its scope line, the other text parts and the JSON of the last one. */
export function toolText(result: Record<string, unknown>): ToolText {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  const all = content.map((c) => c.text ?? '');
  const scope = all[0]?.startsWith('Scope: ') ? all[0] : undefined;
  const texts = scope === undefined ? all : all.slice(1);
  let data: Record<string, unknown> | undefined;
  try {
    data = JSON.parse(texts.at(-1) ?? '') as Record<string, unknown>;
  } catch {
    data = undefined;
  }
  return { isError: result.isError === true, scope, texts, data };
}
