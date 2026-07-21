/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // 与现有自写 CSS 共存：关掉 preflight（base reset）避免冲击其他页面
  corePlugins: { preflight: false },
  theme: {
    extend: {
      // shadcn/ai-elements 用的语义色 → 映射到 Milo 既有 token（styles.css 定义）
      colors: {
        background: "var(--bg)", foreground: "var(--ink)",
        secondary: "var(--panel-2)", muted: "var(--panel-2)",
        "muted-foreground": "var(--ink-3)", border: "var(--line)",
        primary: "var(--pine)", "primary-foreground": "#fff",
        accent: "var(--panel-2)", ring: "var(--pine)",
        card: "var(--panel)", "card-foreground": "var(--ink)",
        popover: "var(--panel)", "popover-foreground": "var(--ink)",
      },
      borderColor: { DEFAULT: "var(--line)" },
    },
  },
}
