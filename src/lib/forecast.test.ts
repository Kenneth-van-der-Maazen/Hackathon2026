import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("forecast output", () => {
  it("has 13 weeks per scenario with required driver fields", () => {
    const path = resolve(__dirname, "../../public/data/forecast.json");
    const data = JSON.parse(readFileSync(path, "utf-8"));

    expect(data.meta).toMatchObject({
      weeks: 13,
      forecastStart: expect.any(String),
      forecastEnd: expect.any(String),
      anchoredTo: expect.any(String),
      dataMinDate: expect.any(String),
      dataMaxDate: expect.any(String),
      editable: true,
    });

    for (const key of ["base", "wet", "dry"]) {
      expect(data[key]).toHaveLength(13);
      const week = data[key][0];
      expect(week).toMatchObject({
        week: 1,
        label: "W1",
        weekStart: expect.any(String),
        weekEnd: expect.any(String),
        chartLabel: expect.any(String),
        materials: expect.any(Number),
        subcontractors: expect.any(Number),
        milestoneBilling: expect.any(Number),
        paymentLag: expect.any(Number),
        weatherImpact: expect.any(Number),
        net: expect.any(Number),
      });
    }
  });

  it("wet quarter early weeks are worse than base", () => {
    const path = resolve(__dirname, "../../public/data/forecast.json");
    const data = JSON.parse(readFileSync(path, "utf-8"));
    const wetEarly = data.wet.slice(0, 4).reduce((s: number, w: { net: number }) => s + w.net, 0);
    const baseEarly = data.base.slice(0, 4).reduce((s: number, w: { net: number }) => s + w.net, 0);
    expect(wetEarly).toBeLessThan(baseEarly);
  });
});
