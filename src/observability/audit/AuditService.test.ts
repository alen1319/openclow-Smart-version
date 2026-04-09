import { describe, expect, it, vi } from "vitest";
import { AuditService } from "./AuditService.js";

describe("AuditService", () => {
  it("logs approval and memory mutation events", async () => {
    const sink = vi.fn();
    const logger = vi.fn();
    const audit = new AuditService(sink, logger);

    await audit.logApproval("ap-1", { uid: "u1" }, true);
    await audit.logMemoryMutation("s-1", "draft", "update");

    expect(sink).toHaveBeenCalledTimes(2);
    expect(audit.listRecent(10)).toHaveLength(2);
  });

  it("does not throw when sink fails", async () => {
    const audit = new AuditService(async () => {
      throw new Error("sink down");
    });

    await expect(audit.logApproval("ap-2", { uid: "u2" }, false)).resolves.toBeUndefined();
  });
});
