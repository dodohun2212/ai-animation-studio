import { describe, expect, it } from "vitest";

import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("reports a healthy service", () => {
    expect(new HealthController().getHealth()).toEqual({ status: "ok" });
  });
});
