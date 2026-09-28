import {
  EMERGENCY_NOTICE,
  SAFETY_CATEGORY_LABEL,
  SAFETY_STATUS_LABEL,
  SHARED_TRIP_TEXT,
  shareUrl,
} from "@/lib/safetyText";
import { safetyCategories, safetyStatuses } from "@/shared/contracts";

describe("safety wording", () => {
  it("labels every category and status", () => {
    for (const c of safetyCategories)
      expect(SAFETY_CATEGORY_LABEL[c]).toBeTruthy();
    for (const s of safetyStatuses) expect(SAFETY_STATUS_LABEL[s]).toBeTruthy();
    expect(Object.keys(SHARED_TRIP_TEXT)).toHaveLength(6);
  });

  it("never claims to contact emergency services", () => {
    expect(EMERGENCY_NOTICE).toMatch(/does not contact emergency services/);
    expect(EMERGENCY_NOTICE).not.toMatch(/we (will )?(call|alert|notify)/i);
  });

  it("builds share links without doubled slashes", () => {
    expect(shareUrl("https://example.test/", "/share/abc")).toBe(
      "https://example.test/share/abc",
    );
    expect(shareUrl("http://192.168.1.2:8081", "/share/abc")).toBe(
      "http://192.168.1.2:8081/share/abc",
    );
  });
});
