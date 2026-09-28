import { describe, expect, it, vi } from "vitest";
import {
  buildTimestampedOutputPath,
  escapeTsvValue,
  parseDurationSeconds,
  parsePositiveInteger,
  parseSourceQuery,
  toQueryRows,
  toTsv,
} from "../src/lib.js";

describe("parseDurationSeconds", () => {
  it.each([
    ["15m", 900],
    ["1h", 3600],
    ["2d", 172800],
  ])("parses %s", (duration, seconds) => {
    expect(parseDurationSeconds(duration)).toBe(seconds);
  });

  it.each(["", "15", "1w", "0m", "-1h", "1.5h"])(
    "rejects invalid duration %s",
    (duration) => {
      expect(() => parseDurationSeconds(duration)).toThrow(/Invalid --since value/);
    },
  );
});

describe("parsePositiveInteger", () => {
  it("returns positive whole numbers", () => {
    expect(parsePositiveInteger("25", "limit")).toBe(25);
  });

  it.each(["0", "-1", "1.5", "abc"])("rejects %s", (value) => {
    expect(() => parsePositiveInteger(value, "limit")).toThrow(
      "Invalid --limit value. Use a positive whole number.",
    );
  });
});

describe("parseSourceQuery", () => {
  it("extracts the log group and removes the SOURCE command", () => {
    expect(
      parseSourceQuery('SOURCE "codebuild-achilles" | fields @timestamp, @message'),
    ).toEqual({
      logGroupName: "codebuild-achilles",
      queryString: "fields @timestamp, @message",
    });
  });

  it("supports SOURCE commands with options before the first pipe", () => {
    expect(
      parseSourceQuery(
        'SOURCE "/aws/example" START=-3600s END=0s | filter @message like /ERROR/',
      ),
    ).toEqual({
      logGroupName: "/aws/example",
      queryString: "filter @message like /ERROR/",
    });
  });

  it("returns undefined when there is no SOURCE command", () => {
    expect(parseSourceQuery("fields @timestamp, @message")).toBeUndefined();
  });

  it("rejects SOURCE-only queries", () => {
    expect(() => parseSourceQuery('SOURCE "codebuild-achilles"')).toThrow(
      "SOURCE query is missing the query body after the first pipe.",
    );
  });
});

describe("toQueryRows", () => {
  it("converts CloudWatch result fields into rows", () => {
    expect(
      toQueryRows([
        [
          { field: "@timestamp", value: "2026-09-28T00:00:00Z" },
          { field: "@message", value: "hello" },
          { field: "@ptr", value: "hidden" },
          { field: "empty", value: "" },
        ],
      ]),
    ).toEqual([
      {
        "@timestamp": "2026-09-28T00:00:00Z",
        "@message": "hello",
      },
    ]);
  });
});

describe("TSV formatting", () => {
  it("returns a no-results message for empty rows", () => {
    expect(toTsv([])).toBe("No results found.\n");
  });

  it("uses the union of row columns and escapes tabs/newlines", () => {
    expect(
      toTsv([
        { a: "one", b: "two\tTabbed" },
        { b: "three\nlines", c: "four" },
      ]),
    ).toBe("a\tb\tc\none\ttwo Tabbed\t\n\tthree lines\tfour\n");
  });

  it("escapes individual TSV values", () => {
    expect(escapeTsvValue("a\tb\nc\r\nd")).toBe("a b c d");
  });
});

describe("buildTimestampedOutputPath", () => {
  it("builds an outputs path from the query basename and timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T15:16:17.123Z"));

    expect(buildTimestampedOutputPath("queries/codebuild-dart-sass.cwql")).toBe(
      "outputs/codebuild-dart-sass-2026-09-28T15-16-17-123Z.tsv",
    );

    vi.useRealTimers();
  });
});
