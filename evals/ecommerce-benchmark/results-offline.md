# Offline Benchmark Results

- mode: `offline-baseline`
- total cases: 30
- total runs: 90
- Success@1: 90.0%
- Pass^3: 90.0%
- Route Accuracy: 100.0%
- Tool Accuracy: 100.0%
- Arg Accuracy: 100.0%
- Follow-up Accuracy: 100.0%
- Approval Compliance: 100.0%
- Retry Recovery Rate: 100.0%
- Compaction Retention Rate (proxy): 100.0%
- Quality Score: 4.60 / 5
- Avg Steps: 3.43
- Avg Tool Calls: 2.93
- Avg Latency: 57.71 ms

## Note

This run uses a deterministic offline benchmark streamFn and mock tools. It validates eval wiring and core orchestration, not live model intelligence.

Compaction metrics here are proxy checks over retained context facts, not live summary-model compaction under external LLM calls.

The 3 remaining failures are rubric-literal mismatches on `T03`, `T14`, and `T16`:
- `无法直接取消` vs `不能直接取消`
- `新的收货地址` vs `新地址`
- `出了什么问题` vs `问题描述`
