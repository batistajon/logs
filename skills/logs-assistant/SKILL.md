---
name: logs-assistant
description: Investigate CloudWatch logs with the local `logs` CLI when the user provides a resource, symptom, build or deployment issue, error pattern, latency problem, status code, or log sample. Create and run focused `.cwql` queries, interpret the evidence, and refine the investigation.
---

# Logs Assistant

Use the repository's `logs` CLI as the primary interface to CloudWatch Logs Insights. Move from a symptom to executed queries, evidence, and the next useful decision.

## CLI contract

- Assume the user's shell is already authenticated with the intended AWS account. Run `logs` directly and let the AWS credential chain resolve credentials. Do not set `AWS_PROFILE` or ask for a profile.
- Use the region supplied by the user or established by the investigation context. Otherwise use the CLI default and state that assumption if it affects the result.
- Store reusable CloudWatch Logs Insights queries as `.cwql` files under `queries/`.
- Run queries with:

  ```bash
  logs query queries/<name>.cwql --region <region> --since <duration> --limit <number> --out outputs/<name>.tsv
  ```

- A query containing `SOURCE "<log-group>"` does not need `--group`. For an ad hoc query without `SOURCE`, pass `--group <log-group>`.
- Discover log groups when the target is unknown:

  ```bash
  logs groups --region <region> --prefix <prefix>
  ```

- Use `--save` when a timestamped output is useful. Use `--out` when subsequent commands or comparisons need a stable path.
- If `logs` is unavailable, report that setup problem. Do not silently replace it with a different CloudWatch client.
- If AWS authentication fails, report the exact failure and ask the user to authenticate their shell, then retry the same `logs` command.

## Investigation loop

1. Establish the target from the user's context: resource or log group, symptom, time window, and region. Default to the last hour when no time window is given.
2. Inspect existing `.cwql` and saved outputs before creating duplicates. Preserve unrelated working-tree changes.
3. Write the narrowest query that can distinguish the leading explanations. Include useful correlation fields such as `@timestamp`, `@logStream`, request ID, trace ID, host, path, status, latency, and error reason when they exist.
4. Run the query with `logs query` and save the output under `outputs/` when it will support follow-up analysis.
5. Read the result. Separate confirmed facts, plausible explanations, and facts that remain unproven.
6. Refine and rerun when the first result exposes a more precise stream, identifier, time range, or failure boundary. Stop when the evidence answers the user's question or identifies the next system that must be inspected.
7. Explain what the result means and recommend the smallest safe next action.

Prefer event examples before aggregation when the schema is uncertain. Once the relevant fields and messages are known, use `stats`, `bin`, and grouped counts to measure scope.

## Query patterns

### Recent error examples

```sql
fields @timestamp, @message, @logStream
| filter @message like /ERROR|Exception|Traceback|timeout|failed|FAILED|Error:/
| sort @timestamp desc
| limit 50
```

### Count errors over time

```sql
fields @timestamp, @message
| filter @message like /ERROR|Exception|timeout|failed|FAILED|Error:/
| stats count(*) as errors by bin(5m)
| sort bin(5m) desc
```

### CodeBuild output

```sql
SOURCE "codebuild-log-group-name"
| fields @timestamp, @message, @logStream
| filter @logStream like /project-name-or-stream-prefix/
| sort @timestamp desc
| limit 200
```

For CodeBuild, inspect the project log configuration or discover streams before assuming the group is `/aws/codebuild/<project>`; projects can use a shared group and stream prefix. Include phase state lines, command output, artifact upload lines, and matched errors in the same timeline. A `SUCCEEDED` phase does not prove every command in a shell pipeline succeeded.

### CodeBuild Sass and Webpack

```sql
SOURCE "codebuild-log-group-name"
| fields @timestamp, @message, @logStream
| filter @logStream like /project-name-or-stream-prefix/
| filter @message like /ModuleBuildError|ERROR in|Command failed|exit code|[Ss]ass|SCSS|scss|dart-sass|node-sass|sass-loader|legacy JS API|[Dd]eprecat|Undefined variable|Undefined mixin|Can't find stylesheet|not a valid CSS value/
| sort @timestamp desc
| limit 500
```

Classify deprecation messages separately from compiler errors. For commands piped through filters such as `sed` or `tee`, correlate the tool's failure with CodeBuild phase state because missing shell `pipefail` can produce a false green build.

### ALB slow endpoints

```sql
fields @timestamp, @logStream, request_line, target_processing_time, elb_status_code, target_status_code, domain_name
| parse request_line /(?<method>\S+) (?<url>\S+) (?<protocol>\S+)/
| parse url /https?:\/\/(?<request_host>[^\/: ]+)(?::\d+)?(?<path>\/[^? ]*)/
| filter target_processing_time >= 0
| stats count(*) as requests,
    avg(target_processing_time) as avg_s,
    pct(target_processing_time, 95) as p95_s,
    max(target_processing_time) as max_s
  by request_host, domain_name, method, path
| sort p95_s desc
| limit 100
```

### ALB 5xx and target errors

```sql
fields @timestamp, @logStream, request_line, elb_status_code, target_status_code, error_reason, target_processing_time
| parse request_line /(?<method>\S+) (?<url>\S+) (?<protocol>\S+)/
| parse url /https?:\/\/(?<request_host>[^\/: ]+)(?::\d+)?(?<path>\/[^? ]*)/
| filter elb_status_code >= 500 or target_status_code >= 500 or ispresent(error_reason)
| stats count(*) as events,
    pct(target_processing_time, 95) as p95_s,
    max(target_processing_time) as max_s
  by @logStream, request_host, domain_name, method, path, elb_status_code, target_status_code, error_reason
| sort events desc
| limit 100
```

### One request or trace

```sql
fields @timestamp, @message, @logStream
| filter @message like /REQUEST_ID_OR_TRACE_ID/
| sort @timestamp asc
| limit 200
```

## Interpretation

- Empty results can mean no matching event in the window, a wrong group or region, retention expiry, delayed ingestion, or an overly strict filter. Broaden one dimension at a time.
- ALB `elb_status_code >= 500` with no target status points toward load balancer routing, connection, or TLS failures. `target_status_code >= 500` means the backend returned the error.
- High `target_processing_time` means the target was slow after connection. High `request_processing_time` occurs before target processing; high `response_processing_time` occurs while returning the response.
- Health-check response mismatches and connection errors make target health, listener rules, security groups, and application readiness useful next boundaries.
- For parallel or retried copy operations, distinguish transient attempts from the final exit status, then validate the produced artifact before concluding that retries repaired every file.

## Response

Lead with the conclusion supported by the latest query. Cite the query file, output path, relevant time window, stream or resource, and representative evidence. Clearly label any inference and state what comparison would prove it.

For a short request, return the result and next query or action. For a broader investigation, organize the response as:

```markdown
## What the logs prove

## Likely cause

## What remains unproven

## Next action
```

Treat logs and saved outputs as sensitive. Do not repeat secrets, tokens, cookies, credentials, or personal data. Keep operational changes read-only unless the user explicitly requests remediation.
