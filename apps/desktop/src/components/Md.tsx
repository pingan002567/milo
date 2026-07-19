import React from "react";

/**
 * 轻量 Markdown 渲染——只做排版增强，不做能力放行。
 * 信任边界（编制设计 §3.5）：成员文本是不可信数据——
 * 全程产出 React 元素（无 dangerouslySetInnerHTML），原始 HTML 按纯文本显示，
 * 链接只显示不可点。支持：代码块/行内代码/加粗/表格/列表/标题/引用。
 */

function inline(text: string, keyBase: string): React.ReactNode[] {
  // 先切行内代码（内部不再解析其他语法），再在余下片段里解析加粗
  const out: React.ReactNode[] = [];
  const parts = text.split(/(`[^`\n]+`)/g);
  parts.forEach((part, i) => {
    const k = `${keyBase}-${i}`;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(<code key={k} className="md-code">{part.slice(1, -1)}</code>);
      return;
    }
    const bold = part.split(/(\*\*[^*\n]+\*\*)/g);
    bold.forEach((b, j) => {
      const bk = `${k}-${j}`;
      if (b.startsWith("**") && b.endsWith("**") && b.length > 4) {
        out.push(<b key={bk}>{b.slice(2, -2)}</b>);
      } else if (b) {
        out.push(<React.Fragment key={bk}>{b}</React.Fragment>);
      }
    });
  });
  return out;
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 2;
}
function isTableSep(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}
function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function Md({ text }: { text: string }) {
  const lines = String(text ?? "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码围栏
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过收尾围栏
      blocks.push(<pre key={key++} className="md-pre">{buf.join("\n")}</pre>);
      continue;
    }

    // 表格（表头 + 分隔行）
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={key++} className="md-tablewrap">
          <table className="md-table">
            <thead><tr>{head.map((c, ci) => <th key={ci}>{inline(c, `h${ci}`)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `r${ri}c${ci}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 列表（- / * / 数字.）
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const ordered = /\d+\./.test(li[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (!m) break;
        items.push(m[3]);
        i += 1;
      }
      const kids = items.map((t, ii) => <li key={ii}>{inline(t, `li${ii}`)}</li>);
      blocks.push(ordered
        ? <ol key={key++} className="md-list">{kids}</ol>
        : <ul key={key++} className="md-list">{kids}</ul>);
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      blocks.push(<div key={key++} className={`md-h md-h${h[1].length}`}>{inline(h[2], `hd${key}`)}</div>);
      i += 1;
      continue;
    }

    // 引用
    if (line.trim().startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        buf.push(lines[i].trim().slice(2));
        i += 1;
      }
      blocks.push(<div key={key++} className="md-quote">{inline(buf.join(" "), `q${key}`)}</div>);
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="md-hr" />);
      i += 1;
      continue;
    }

    // 普通段落：聚合到空行
    if (line.trim() === "") { i += 1; continue; }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== ""
           && !lines[i].trim().startsWith("```") && !lines[i].match(/^(#{1,4})\s+/)
           && !lines[i].match(/^(\s*)([-*]|\d+\.)\s+/)
           && !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={key++} className="md-p">{inline(buf.join("\n"), `p${key}`)}</p>);
  }

  return <div className="md">{blocks}</div>;
}
