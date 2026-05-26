# Semi-Online Benchmark Results

- provider: `google`
- model: `gemini-2.5-flash`
- execution mode: `serial`
- sleep between runs: 4000 ms
- quota backoff: base 5000 ms, max 60000 ms, retries 4
- total cases: 10
- total runs: 30
- blocked runs: 21
- blocked by quota: 21
- scorable runs: 9
- scorable cases: 4
- Success@1: 25.0%
- Pass^3: 50.0%
- Route Accuracy: 44.4%
- Tool Accuracy: 44.4%
- Arg Accuracy: 33.3%
- Follow-up Accuracy: N/A
- Approval Compliance: N/A
- Retry Recovery: 100.0%
- Compaction Retention: N/A
- Quality Score: 2.33 / 5
- Avg Steps: 2.22
- Avg Tool Calls: 1.22
- Avg Latency: 3071.73 ms

## Note

This run uses a real configured LLM together with controlled mock tools.

Quota-blocked runs are tracked separately as `blocked_by_quota` and are excluded from success-rate denominators.
The runner executes serially, sleeps a fixed interval between runs, and applies exponential backoff when it sees 429/quota-style failures.