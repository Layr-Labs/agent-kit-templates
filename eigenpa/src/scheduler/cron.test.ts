import { describe, it, expect } from "vitest";
import { parseCron, cronMatches, nextRunTime } from "./cron.js";

describe("cron parser", () => {
  describe("parseCron", () => {
    it("parses all-wildcards", () => {
      const fields = parseCron("* * * * *");
      expect(fields.minute).toHaveLength(60);
      expect(fields.hour).toHaveLength(24);
      expect(fields.dayOfMonth).toHaveLength(31);
      expect(fields.month).toHaveLength(12);
      expect(fields.dayOfWeek).toHaveLength(7);
    });

    it("parses specific values", () => {
      const fields = parseCron("30 8 * * *");
      expect(fields.minute).toEqual([30]);
      expect(fields.hour).toEqual([8]);
    });

    it("parses step values", () => {
      const fields = parseCron("*/15 * * * *");
      expect(fields.minute).toEqual([0, 15, 30, 45]);
    });

    it("parses comma-separated values", () => {
      const fields = parseCron("0 8,12,18 * * *");
      expect(fields.hour).toEqual([8, 12, 18]);
    });

    it("parses ranges", () => {
      const fields = parseCron("0 8 * * 1-5");
      expect(fields.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    it("rejects invalid field count", () => {
      expect(() => parseCron("* * *")).toThrow("expected 5 fields");
    });
  });

  describe("cronMatches", () => {
    it("matches daily at 8:00 AM", () => {
      const date = new Date("2026-03-28T08:00:00");
      expect(cronMatches("0 8 * * *", date)).toBe(true);
    });

    it("does not match wrong minute", () => {
      const date = new Date("2026-03-28T08:01:00");
      expect(cronMatches("0 8 * * *", date)).toBe(false);
    });

    it("matches weekday-only schedule on Monday", () => {
      // 2026-03-30 is a Monday
      const monday = new Date("2026-03-30T09:00:00");
      expect(cronMatches("0 9 * * 1-5", monday)).toBe(true);
    });

    it("does not match weekday schedule on Sunday", () => {
      // 2026-03-29 is a Sunday
      const sunday = new Date("2026-03-29T09:00:00");
      expect(cronMatches("0 9 * * 1-5", sunday)).toBe(false);
    });

    it("matches every-15-minutes", () => {
      const date = new Date("2026-03-28T10:30:00");
      expect(cronMatches("*/15 * * * *", date)).toBe(true);

      const other = new Date("2026-03-28T10:07:00");
      expect(cronMatches("*/15 * * * *", other)).toBe(false);
    });
  });

  describe("nextRunTime", () => {
    it("computes next run for daily 8am", () => {
      const after = new Date("2026-03-28T07:30:00");
      const next = nextRunTime("0 8 * * *", after);
      expect(next.getHours()).toBe(8);
      expect(next.getMinutes()).toBe(0);
      expect(next.getDate()).toBe(28);
    });

    it("rolls to next day if past the time", () => {
      const after = new Date("2026-03-28T09:00:00");
      const next = nextRunTime("0 8 * * *", after);
      expect(next.getDate()).toBe(29);
      expect(next.getHours()).toBe(8);
    });

    it("skips weekends for weekday schedule", () => {
      // 2026-03-28 is Saturday
      const saturday = new Date("2026-03-28T10:00:00");
      const next = nextRunTime("0 9 * * 1-5", saturday);
      // Should be Monday 2026-03-30
      expect(next.getDay()).toBe(1); // Monday
      expect(next.getHours()).toBe(9);
    });

    it("handles every-30-minute schedule", () => {
      const after = new Date("2026-03-28T10:15:00");
      const next = nextRunTime("*/30 * * * *", after);
      expect(next.getMinutes()).toBe(30);
    });
  });
});
