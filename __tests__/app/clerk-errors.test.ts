import { clerkErrorCode, clerkErrorKey } from "@/lib/clerkErrors";
import { dictionaries, translate } from "@/lib/i18n/translate";

describe("identity provider errors", () => {
  it("reads the code from thrown and returned error shapes", () => {
    expect(
      clerkErrorCode({ errors: [{ code: "form_password_incorrect" }] }),
    ).toBe("form_password_incorrect");
    expect(clerkErrorCode({ code: "too_many_requests" })).toBe(
      "too_many_requests",
    );
    expect(clerkErrorCode({ errors: [] })).toBeNull();
    expect(clerkErrorCode(new Error("boom"))).toBeNull();
    expect(clerkErrorCode(null)).toBeNull();
    expect(clerkErrorCode("form_password_incorrect")).toBeNull();
  });

  it("maps known codes to the app's own wording in both languages", () => {
    for (const code of [
      "form_password_incorrect",
      "form_identifier_not_found",
      "form_identifier_exists",
      "form_password_pwned",
      "form_password_length_too_short",
      "form_code_incorrect",
      "verification_expired",
      "too_many_requests",
    ]) {
      const key = clerkErrorKey({ errors: [{ code }] });
      expect(key).not.toBeNull();
      for (const language of Object.keys(dictionaries) as "en"[]) {
        const text = translate(language, key!);
        expect(text).not.toBe(key);
        expect(text.length).toBeGreaterThan(10);
      }
    }
  });

  it("never passes provider text through for unknown codes", () => {
    expect(
      clerkErrorKey({
        errors: [{ code: "something_new", longMessage: "Raw provider text" }],
      }),
    ).toBeNull();
  });
});
