import { Dishwasher } from "../src/dishwasher/dishwasher.js";

describe("Dishwasher.formatError", () => {
  it("includes the message and stack for Error instances", () => {
    const dishwasher = Object.create(Dishwasher.prototype) as unknown as {
      formatError: (error: unknown) => string;
    };

    const formatted = dishwasher.formatError(new Error("boom"));

    expect(formatted).toContain("boom");
    expect(formatted).toContain("Error");
  });
});
