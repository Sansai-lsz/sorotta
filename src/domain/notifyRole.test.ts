import { describe, expect, it } from "vitest";
import { checkNotifyRole, chooseNotifyRole, EVERYONE_ROLE_REFUSAL, UNMENTIONABLE_WARNING } from "./notifyRole.ts";

describe("checkNotifyRole", () => {
  it("サーバーと同じ ID のロール（@everyone）は断る", () => {
    expect(checkNotifyRole("g", "g", true)).toEqual({ ok: false, message: EVERYONE_ROLE_REFUSAL });
  });

  it("メンションを許可していないロールは受け付けたうえで注意する", () => {
    expect(checkNotifyRole("r1", "g", false)).toEqual({ ok: true, warning: UNMENTIONABLE_WARNING });
  });

  it("メンションを許可しているロールはそのまま受け付ける", () => {
    expect(checkNotifyRole("r1", "g", true)).toEqual({ ok: true, warning: null });
  });

  it("ロールの情報が届かなければ注意しない", () => {
    expect(checkNotifyRole("r1", "g", undefined)).toEqual({ ok: true, warning: null });
  });
});

describe("chooseNotifyRole", () => {
  it("募集で指定したロールをゲームの既定より優先する", () => {
    expect(chooseNotifyRole("r2", "r1")).toBe("r2");
  });

  it("募集で指定しなければゲームの既定を使う", () => {
    expect(chooseNotifyRole(undefined, "r1")).toBe("r1");
  });

  it("どちらもなければメンションしない", () => {
    expect(chooseNotifyRole(undefined, null)).toBeNull();
  });
});
