---
name: citation-check
description: 核对文献引用的完整性与可溯源性；在输出文献清单前使用。
version: 0.1.0
author: "@milo-official"
allowed-tools: []
---

# 引用核对

对每条引用检查：

1. **四要素齐全**：作者、标题、发表载体（会议/期刊）、年份。
2. **可溯源**：附 DOI 或 arXiv 编号；无法提供时标注「未能获取」，不得杜撰。
3. **年份一致性**：预印本与正式发表年份不同时，两者都注明。

输出格式：Markdown 列表，每条一行，末尾括注 DOI/arXiv。
