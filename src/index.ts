#!/usr/bin/env node

import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  GetQueryResultsCommand,
  StartQueryCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { Command } from "commander";
import {
  buildTimestampedOutputPath,
  parseDurationSeconds,
  parsePositiveInteger,
  parseSourceQuery,
  readQueryFile,
  saveQueryResults,
  toQueryRows,
  type QueryRow,
} from "./lib.js";

const program = new Command();

const DEFAULT_REGION = "us-east-2";
const DEFAULT_SINCE = "1h";
const DEFAULT_LIMIT = 100;
const POLL_INTERVAL_MS = 1_000;

type QueryOptions = {
  group?: string;
  region: string;
  since: string;
  limit: string;
  save?: boolean;
  out?: string;
};

type GroupsOptions = {
  region: string;
  prefix?: string;
};

program
  .name("logs")
  .description("Run CloudWatch Logs Insights queries from local query files")
  .version("1.0.0");

program
  .command("query")
  .description("Run a CloudWatch Logs Insights query from a file")
  .argument("<file>", "Path to a CloudWatch Logs Insights query file")
  .option(
    "-g, --group <logGroup>",
    "CloudWatch log group to query. Optional when the query uses SOURCE.",
  )
  .option("-r, --region <region>", "AWS region", DEFAULT_REGION)
  .option(
    "-s, --since <duration>",
    "How far back to search, for example 15m, 1h, or 2d",
    DEFAULT_SINCE,
  )
  .option(
    "-l, --limit <number>",
    "Maximum number of query results",
    String(DEFAULT_LIMIT),
  )
  .option("--save", "Save query results to a timestamped file in ./outputs")
  .option("-o, --out <file>", "Save query results to a specific file path")
  .action(async (file: string, options: QueryOptions) => {
    const rawQueryString = await readQueryFile(file);
    const sourceQuery = parseSourceQuery(rawQueryString);
    const logGroupName = options.group ?? sourceQuery?.logGroupName;
    const queryString = sourceQuery?.queryString ?? rawQueryString;
    const limit = parsePositiveInteger(options.limit, "limit");
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - parseDurationSeconds(options.since);

    if (!logGroupName) {
      throw new Error(
        "Missing --group. Provide a log group or use a query file with a SOURCE command.",
      );
    }

    const client = new CloudWatchLogsClient({
      region: options.region,
    });

    console.error(`Starting query against ${logGroupName} in ${options.region}...`);

    const startResponse = await client.send(
      new StartQueryCommand({
        logGroupName,
        queryString,
        startTime,
        endTime,
        limit,
      }),
    );

    if (!startResponse.queryId) {
      throw new Error("AWS did not return a query id.");
    }

    const results = await waitForQuery(client, startResponse.queryId);
    const rows = toQueryRows(results);

    printQueryResults(rows);

    if (options.save || options.out) {
      const outputPath = options.out ?? buildTimestampedOutputPath(file);
      await saveQueryResults(outputPath, {
        file,
        logGroupName,
        region: options.region,
        since: options.since,
        rows,
      });
      console.error(`Saved results to ${outputPath}`);
    }
  });

program
  .command("groups")
  .description("List CloudWatch log groups")
  .option("-r, --region <region>", "AWS region", DEFAULT_REGION)
  .option(
    "-p, --prefix <prefix>",
    "Only show log groups that start with this prefix",
  )
  .action(async (options: GroupsOptions) => {
    const client = new CloudWatchLogsClient({
      region: options.region,
    });

    let nextToken: string | undefined;
    let found = 0;

    do {
      const response = await client.send(
        new DescribeLogGroupsCommand({
          logGroupNamePrefix: options.prefix,
          nextToken,
        }),
      );

      for (const logGroup of response.logGroups ?? []) {
        if (logGroup.logGroupName) {
          console.log(logGroup.logGroupName);
          found += 1;
        }
      }

      nextToken = response.nextToken;
    } while (nextToken);

    if (found === 0) {
      console.log("No log groups found.");
    }
  });

async function waitForQuery(client: CloudWatchLogsClient, queryId: string) {
  while (true) {
    const response = await client.send(
      new GetQueryResultsCommand({
        queryId,
      }),
    );

    switch (response.status) {
      case "Complete":
        return response.results ?? [];
      case "Scheduled":
      case "Running":
        await sleep(POLL_INTERVAL_MS);
        break;
      case "Cancelled":
      case "Failed":
      case "Timeout":
      case "Unknown":
        throw new Error(`Query ended with status: ${response.status}`);
      default:
        throw new Error(
          `Unexpected query status: ${response.status ?? "missing"}`,
        );
    }
  }
}

function printQueryResults(rows: QueryRow[]): void {
  if (rows.length === 0) {
    console.log("No results found.");
    return;
  }

  console.table(rows);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}

function printError(error: unknown): void {
  if (!isAwsError(error)) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    return;
  }

  console.error(`AWS error: ${error.name}`);
  console.error(error.message);

  switch (error.name) {
    case "ResourceNotFoundException":
      console.error("\nThe log group or SOURCE prefix was not found in this account/region.");
      console.error("Try listing matching log groups first:");
      console.error(`  npm run dev -- groups --region ${DEFAULT_REGION} --prefix /aws/vendedlogs`);
      break;
    case "AccessDeniedException":
    case "UnauthorizedOperation":
      console.error("\nYour current AWS identity does not have permission for this CloudWatch Logs action.");
      console.error("Check your AWS SSO/profile login and IAM permissions.");
      break;
    case "ExpiredTokenException":
    case "UnrecognizedClientException":
      console.error("\nYour AWS credentials look expired or invalid.");
      console.error("Try logging in again, for example:");
      console.error("  aws sso login --profile <profile-name>");
      break;
  }
}

type AwsError = Error & {
  name: string;
  $metadata?: {
    httpStatusCode?: number;
    requestId?: string;
  };
};

function isAwsError(error: unknown): error is AwsError {
  return error instanceof Error && "$metadata" in error;
}

program.parseAsync().catch((error: unknown) => {
  printError(error);
  process.exitCode = 1;
});
