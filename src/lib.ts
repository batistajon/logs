import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

export type QueryRow = Record<string, string>;

type QueryResultField = {
  field?: string;
  value?: string;
};

export async function readQueryFile(file: string): Promise<string> {
  const path = resolve(process.cwd(), file);
  const query = await readFile(path, "utf8");
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    throw new Error(`Query file is empty: ${path}`);
  }

  return trimmedQuery;
}

export function parseSourceQuery(queryString: string): { logGroupName: string; queryString: string } | undefined {
  const match = queryString.match(/^\s*SOURCE\s+"([^"]+)"[^|]*(?:\|\s*)?/i);

  if (!match?.[1]) {
    return undefined;
  }

  const withoutSource = queryString.slice(match[0].length).trim();

  if (!withoutSource) {
    throw new Error("SOURCE query is missing the query body after the first pipe.");
  }

  return {
    logGroupName: match[1],
    queryString: withoutSource,
  };
}

export function parseDurationSeconds(duration: string): number {
  const match = duration.match(/^(\d+)([mhd])$/);

  if (!match) {
    throw new Error(
      "Invalid --since value. Use a duration like 15m, 1h, or 2d.",
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(
      "Invalid --since value. Duration must be greater than zero.",
    );
  }

  switch (unit) {
    case "m":
      return amount * 60;
    case "h":
      return amount * 60 * 60;
    case "d":
      return amount * 24 * 60 * 60;
    default:
      throw new Error("Invalid --since unit. Use m, h, or d.");
  }
}

export function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid --${optionName} value. Use a positive whole number.`,
    );
  }

  return parsed;
}

export function toQueryRows(results: QueryResultField[][]): QueryRow[] {
  return results.map((fields) => {
    const row: QueryRow = {};

    for (const field of fields) {
      if (field.field && field.value && field.field !== "@ptr") {
        row[field.field] = field.value;
      }
    }

    return row;
  });
}

export async function saveQueryResults(
  outputPath: string,
  metadata: {
    file: string;
    logGroupName: string;
    region: string;
    since: string;
    rows: QueryRow[];
  },
): Promise<void> {
  const resolvedPath = resolve(process.cwd(), outputPath);
  await mkdir(resolve(resolvedPath, ".."), { recursive: true });

  const content = [
    `# CloudWatch Logs query results`,
    `file: ${metadata.file}`,
    `logGroup: ${metadata.logGroupName}`,
    `region: ${metadata.region}`,
    `since: ${metadata.since}`,
    `createdAt: ${new Date().toISOString()}`,
    "",
    toTsv(metadata.rows),
  ].join("\n");

  await writeFile(resolvedPath, content, "utf8");
}

export function buildTimestampedOutputPath(queryFile: string): string {
  const extension = extname(queryFile);
  const queryName = basename(queryFile, extension);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return join("outputs", `${queryName}-${timestamp}.tsv`);
}

export function toTsv(rows: QueryRow[]): string {
  if (rows.length === 0) {
    return "No results found.\n";
  }

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [columns.join("\t")];

  for (const row of rows) {
    lines.push(columns.map((column) => escapeTsvValue(row[column] ?? "")).join("\t"));
  }

  return `${lines.join("\n")}\n`;
}

export function escapeTsvValue(value: string): string {
  return value.replace(/\t/g, " ").replace(/\r?\n/g, " ");
}
