# Ecommerce Benchmark v1

这是一个面向“电商售后 Agent”的第一版小评测集，目标是：

- 可复现
- 可自动判分
- 能覆盖 Agent 核心机制

## 文件说明

- `policy.md`: 固定规则文档
- `orders.json`: 固定订单数据
- `products.json`: 固定商品数据
- `benchmark.jsonl`: 30 条正式评测样本
- `benchmark.csv`: 同一批样本的表格版
- `results.schema.json`: 单次运行结果字段模板

## 建议跑法

每条任务跑 3 次，分别记录结果，再汇总：

- `Success@1`
- `Pass^3`
- `Route Accuracy`
- `Tool+Arg Accuracy`
- `Follow-up Accuracy`
- `Approval Compliance`
- `Retry Recovery Rate`
- `Compaction Retention Rate`
- `Quality Score / 5`
