import { CircleCheck } from "lucide-react";

export function FeishuSendSuccess({
  recipientName,
}: {
  recipientName?: string;
}) {
  return (
    <div className="feishu-send-success" role="status">
      <CircleCheck size={26} aria-hidden="true" />
      <div>
        <strong>发送成功</strong>
        {recipientName && <span>已发送给 {recipientName}</span>}
      </div>
    </div>
  );
}
