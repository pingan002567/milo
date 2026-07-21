// Message primitives copied from DeerFlow (bytedance/deer-flow) frontend
// ai-elements/message.tsx, MIT License. Only the role type is inlined here
// (upstream uses ai-sdk UIMessage["role"]); classNames/structure unchanged.
// Copyright (c) 2025 Bytedance Ltd.; (c) 2025-2026 DeerFlow Authors. See /NOTICE.
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant" | "system";
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-visible",
      "group-[.is-user]:overflow-hidden",
      "group-[.is-user]:bg-secondary group-[.is-user]:text-foreground group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:px-4 group-[.is-user]:py-3",
      "group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageToolbarProps = HTMLAttributes<HTMLDivElement>;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-4 flex w-full items-center justify-between gap-4",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
