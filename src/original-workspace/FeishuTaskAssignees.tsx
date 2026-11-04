import { Popover } from "@base-ui/react/popover";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The compact preview never limits the actual roster or the filter data. */
export function FeishuTaskAssignees({
  ids,
  name,
}: {
  ids: string[];
  name: (id: string) => string;
}) {
  if (!ids.length)
    return <span className="feishu-task-unassigned">未分配负责人</span>;
  if (ids.length === 1) return <span>{name(ids[0])}</span>;
  return (
    <Popover.Root>
      <Popover.Trigger
        className="feishu-assignee-trigger"
        aria-label={`查看全部${ids.length}位负责人`}
      >
        <span className="feishu-assignee-preview">
          {ids.slice(0, 2).map((id, i) => (
            <span key={id}>
              {i > 0 && "、"}
              <span>{name(id)}</span>
            </span>
          ))}
          {ids.length > 2 && "…"}
        </span>
        <span className="feishu-assignee-count">
          共{ids.length}人<ChevronDown aria-hidden="true" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={6}
          align="start"
          className="feishu-assignee-positioner"
        >
          <Popover.Popup className="feishu-assignee-popover">
            <div className="feishu-assignee-popover-header">
              <Popover.Title>任务负责人 · {ids.length}人</Popover.Title>
              <Popover.Close
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="关闭负责人名单"
                  />
                }
              >
                <X />
              </Popover.Close>
            </div>
            <ul className="feishu-assignee-roster" aria-label="全部负责人">
              {ids.map((id) => (
                <li key={id}>{name(id)}</li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
