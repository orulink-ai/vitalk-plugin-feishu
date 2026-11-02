# ViTalk 飞书插件

独立插件 ID 为 `vitalk-plugin-feishu`，初始版本 0.1.0。页面和业务调用位于本仓库，桌面端保留录音、插件快捷键、授权、安全存储、`lark-cli` 和权限校验网关。插件只使用 `vitalk-plugin/v1` SDK 通道访问飞书。

`npm ci` 后运行 `npm run typecheck`、`npm test`、`npm run build`。构建产物在 `dist/vitalk-plugin-feishu.vitalk-plugin.json`，可从 ViTalk 插件商店手动导入。安装时确认三项飞书权限，启用后在插件设置中配置语音快捷键。

消息必须先准备草稿、选择收件人并人工确认。任务页面支持列表与完成，日程页面支持查看；语音创建任务和日程由桌面端原生网关执行。普通“会议”按日程处理，未指定结束时间默认 30 分钟；视频会议不在本版自动创建范围内。

真实飞书操作需要本机 `lark-cli` 及已授权账号。构建与模拟测试不能代替实际账号验收。
