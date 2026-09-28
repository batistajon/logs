# logs

Small CloudWatch Logs Insights CLI for running local `.cwql` query files.

## Setup

```bash
npm install
npm run build
```

Run tests:

```bash
npm test
```

## CLI usage

During development:

```bash
AWS_PROFILE=<profile> npm run dev -- query queries/example.cwql --region us-west-2 --since 1h
```

After building, run the compiled bin directly:

```bash
AWS_PROFILE=<profile> ./dist/index.js query queries/example.cwql --region us-west-2 --since 1h
```

Or link it globally:

```bash
npm link
logs query queries/example.cwql --region us-west-2 --since 1h
```

## Query examples

Save output to a file:

```bash
AWS_PROFILE=<profile> logs query queries/example.cwql --region us-west-2 --since 1h --out outputs/results.tsv
```

Save output to a timestamped file under `outputs/`:

```bash
AWS_PROFILE=<profile> logs query queries/example.cwql --region us-west-2 --since 1h --save
```

List log groups:

```bash
AWS_PROFILE=<profile> logs groups --region us-west-2 --prefix codebuild
```

Query files can include a `SOURCE "log-group"` line, so `--group` is not required.

## CodeBuild Dart Sass query

This repo includes a targeted query for the Node.js upgrade / Dart Sass investigation:

```bash
AWS_PROFILE=tad-achilles logs query queries/codebuild-dart-sass.cwql --region us-west-2 --since 24h --out outputs/codebuild-dart-sass.tsv
```

For multiple theme build streams, use a stream filter like:

```sql
SOURCE "codebuild-achilles"
| fields @timestamp, @message, @logStream
| filter @logStream like /tadvantagealpha-staging-themes-(0|1|2)/
| filter @message like /[Ss]ass|SCSS|scss|dart [Ss]ass|dart-sass|node-sass|sass-loader|legacy JS API|legacy js api|legacy-js-api|[Dd]eprecat|@import|Undefined variable|Undefined mixin|Can't find stylesheet|not a valid CSS value|Error:.*Sass/
| sort @timestamp desc
| limit 200
```

## Included agent skill

This repo distributes a reusable agent skill at:

```text
skills/logs-assistant/SKILL.md
```

The skill helps agents interpret CloudWatch/application logs, write focused Logs Insights queries, and recommend safe
next debugging steps.

To install it into a local agent skill directory, copy the folder:

```bash
mkdir -p ~/.agents/skills/logs-assistant
cp skills/logs-assistant/SKILL.md ~/.agents/skills/logs-assistant/SKILL.md
```
