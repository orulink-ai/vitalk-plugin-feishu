import { useId } from "react";
import { History, ChevronDown } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AiReply } from "../experiments/client";
import { FeishuActivityPanel } from "./FeishuActivityPanel";
export function WorkspaceSelect({
  label,
  ariaLabel,
  value,
  items,
  onChange,
}: {
  label: string;
  ariaLabel?: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value}
        items={items}
        onValueChange={(v) => {
          if (v !== null) onChange(String(v));
        }}
      >
        <SelectTrigger id={id} aria-label={ariaLabel ?? label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
export function WorkspaceHistory({
  replies,
  kind,
}: {
  replies: AiReply[];
  kind: "feishuTask" | "feishuMeeting";
}) {
  const count = replies.filter(
    (reply) => reply.command?.destination === kind,
  ).length;
  return (
    <details className="feishu-execution-disclosure">
      <summary>
        <History aria-hidden="true" />
        <span>最近执行记录</span>
        <span className="feishu-history-count">{count}</span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <FeishuActivityPanel replies={replies} kind={kind} />
    </details>
  );
}
