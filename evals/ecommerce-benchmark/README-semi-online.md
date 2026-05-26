# Ecommerce Semi-Online Benchmark v1

这是一套 10 条半在线验证集，用于验证：

- 真实在线 LLM 接入后，路由是否稳定
- 工具选择与参数是否正确
- 缺信息时是否会先追问
- 写操作前是否会做 approval
- 工具失败后是否会重试或恢复
- 长上下文下是否还能保持正确引用

## 配置原则

- 模型：真实在线 LLM
- 工具：受控 mock / 半真实接口
- 每条任务跑 3 次
- 结果判分：语义等价优先
- 过程判分：严格

## 输出指标

- `success`
- `route_pass`
- `tool_pass`
- `arg_pass`
- `followup_pass`
- `approval_pass`
- `retry_pass`
- `compaction_pass`
- `quality_score`
- `steps`
- `tool_calls`
- `latency_ms`

## 文件说明

- `benchmark-semi-online.jsonl`: 10 条半在线验证样本
- `benchmark-semi-online.csv`: 同一批样本的表格版
- `results.schema.json`: 运行结果字段模板，可复用离线版

## 注意

这套集子强调“真实模型接入后的机制稳定性”，不是文风评测。
过程层一旦出错，例如该追问没追问、该确认没确认、该重试没重试，应直接记失败。
