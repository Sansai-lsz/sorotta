import { describe, expect, it } from "vitest";
import { resolveAnswer, resolveUndo } from "./answer.ts";

const night = { scope: "night" } as const;
const any = { scope: "any" } as const;

describe("resolveAnswer", () => {
  describe("時刻のボタン", () => {
    it("過ぎていない時刻ならその時刻で参加する", () => {
      expect(resolveAnswer({ kind: "hour", hour: 22 }, night, 21.5)).toEqual({
        ok: true,
        op: { kind: "slot", bucket: "night", hour: 22, now: false },
      });
    });

    it("今の時刻はまだ過ぎていない", () => {
      expect(resolveAnswer({ kind: "hour", hour: 21 }, night, 21.5).ok).toBe(true);
    });

    it("過ぎた時刻は断る", () => {
      expect(resolveAnswer({ kind: "hour", hour: 20 }, night, 21.5)).toEqual({
        ok: false,
        message: "その時刻はもう過ぎています",
      });
    });

    it("募集の時間帯にない時刻は使えない", () => {
      expect(resolveAnswer({ kind: "hour", hour: 12 }, night, 9)).toEqual({
        ok: false,
        message: "このボタンは使えません",
      });
    });

    it("いつでもの募集では使えない", () => {
      expect(resolveAnswer({ kind: "hour", hour: 21 }, any, 9).ok).toBe(false);
    });
  });

  describe("今すぐ", () => {
    it("今の時刻に ⚡ の印を付けて参加する", () => {
      expect(resolveAnswer({ kind: "now", bucket: "night" }, night, 21.5)).toEqual({
        ok: true,
        op: { kind: "slot", bucket: "night", hour: 21, now: true },
      });
    });

    it("深夜の今すぐは 24 以上の時刻になる", () => {
      expect(resolveAnswer({ kind: "now", bucket: "late" }, { scope: "late" }, 25.2)).toEqual({
        ok: true,
        op: { kind: "slot", bucket: "late", hour: 25, now: true },
      });
    });

    it("今がその時間帯でなければ断る", () => {
      expect(resolveAnswer({ kind: "now", bucket: "night" }, night, 16.5)).toEqual({
        ok: false,
        message: "今はその時間帯ではありません",
      });
    });

    it("募集にない時間帯は使えない", () => {
      expect(resolveAnswer({ kind: "now", bucket: "noon" }, night, 15).ok).toBe(false);
    });
  });

  describe("セレクト", () => {
    it("時刻を選ぶとその時間帯の時刻で参加する", () => {
      expect(resolveAnswer({ kind: "select", bucket: "noon", value: { kind: "hour", hour: 15 } }, any, 9)).toEqual({
        ok: true,
        op: { kind: "slot", bucket: "noon", hour: 15, now: false },
      });
    });

    it("過ぎた時刻は断る", () => {
      expect(resolveAnswer({ kind: "select", bucket: "noon", value: { kind: "hour", hour: 13 } }, any, 15)).toEqual({
        ok: false,
        message: "その時刻はもう過ぎています",
      });
    });

    it("別の時間帯の時刻は使えない", () => {
      expect(resolveAnswer({ kind: "select", bucket: "noon", value: { kind: "hour", hour: 21 } }, any, 9).ok).toBe(
        false,
      );
    });

    it("今すぐを選ぶと今の時刻に ⚡ の印を付ける", () => {
      expect(resolveAnswer({ kind: "select", bucket: "noon", value: { kind: "now" } }, any, 15.5)).toEqual({
        ok: true,
        op: { kind: "slot", bucket: "noon", hour: 15, now: true },
      });
    });

    it("無理を選ぶとその時間帯の回答を消す", () => {
      expect(resolveAnswer({ kind: "select", bucket: "night", value: { kind: "none" } }, any, 9)).toEqual({
        ok: true,
        op: { kind: "clear", bucket: "night" },
      });
    });

    it("募集にない時間帯は使えない", () => {
      expect(resolveAnswer({ kind: "select", bucket: "noon", value: { kind: "none" } }, night, 9).ok).toBe(false);
    });
  });

  describe("いつでもOK", () => {
    it("いつでもの募集なら切り替える", () => {
      expect(resolveAnswer({ kind: "anytime" }, any, 9)).toEqual({ ok: true, op: { kind: "toggleAnytime" } });
    });

    it("時間帯を指定した募集では使えない", () => {
      expect(resolveAnswer({ kind: "anytime" }, night, 9).ok).toBe(false);
    });
  });

  it("今日はパスはいつでも受け付ける", () => {
    expect(resolveAnswer({ kind: "pass" }, night, 29)).toEqual({ ok: true, op: { kind: "pass" } });
  });
});

describe("resolveUndo", () => {
  it("募集に含まれる時間帯だけを取り消す", () => {
    expect(resolveUndo("night", night)).toEqual({ ok: true, op: { kind: "clear", bucket: "night" } });
    expect(resolveUndo("noon", night).ok).toBe(false);
  });

  it("いつでもOK はいつでもの募集でだけ取り消す", () => {
    expect(resolveUndo("anytime", any)).toEqual({ ok: true, op: { kind: "clearAnytime" } });
    expect(resolveUndo("anytime", night).ok).toBe(false);
  });

  it("パスも全部取り消すで未回答に戻す", () => {
    expect(resolveUndo("all", night)).toEqual({ ok: true, op: { kind: "clearAll" } });
  });
});
