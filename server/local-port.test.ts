import { describe, expect, it } from "vitest";

import { ensureLocalPortFree, LocalPortError, parseLsof } from "./local-port";

const free = { isFree: async () => true, holder: async () => null };
const busy = (holder: string | null) => ({ isFree: async () => false, holder: async () => holder });

async function failure(promise: Promise<void>): Promise<LocalPortError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LocalPortError) return error;
    throw error;
  }
  throw new Error("expected a LocalPortError");
}

describe("ensureLocalPortFree", () => {
  it("free port resolves", async () => {
    await expect(ensureLocalPortFree(9100, free)).resolves.toBeUndefined();
  });

  it("busy port throws with holder", async () => {
    const error = await failure(ensureLocalPortFree(9100, busy("node (pid 42)")));
    expect(error.message).toBe("port 9100 is in use on this Mac by node (pid 42)");
    expect(error.port).toBe(9100);
    expect(error.holder).toBe("node (pid 42)");
  });

  it("busy port with unknown holder", async () => {
    const error = await failure(ensureLocalPortFree(9100, busy(null)));
    expect(error.message).toBe("port 9100 is in use on this Mac");
    expect(error.holder).toBeNull();
  });

  it("privileged port throws", async () => {
    const error = await failure(ensureLocalPortFree(80, free));
    expect(error.message).toBe("port 80 is below 1024 and is not forwarded");
  });
});

describe("parseLsof", () => {
  it("reads command and pid from -F output", () => {
    expect(parseLsof("p42\ncnode\nn127.0.0.1:9100\n")).toBe("node (pid 42)");
  });

  it("returns null for empty output", () => {
    expect(parseLsof("")).toBeNull();
  });
});
