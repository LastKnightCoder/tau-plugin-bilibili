import { expect, it, vi } from "vitest";
import { av2bv, credentialsFromQr, isBilibiliUrl, parseVideoUrl } from "./api";
import { createBilibiliInstance } from "./provider";

const signal = () => new AbortController().signal;
const json = (data: unknown, code = 0) =>
  new Response(JSON.stringify({ code, message: code ? "错误" : "0", data }), {
    headers: { "content-type": "application/json" },
  });

const view = {
  bvid: "BV1xx411c7mD",
  cid: 100,
  title: "费曼学习法",
  pic: "https://i0.hdslb.com/cover.jpg",
  pages: [
    { cid: 100, page: 1, part: "引言" },
    { cid: 200, page: 2, part: "第二讲" },
  ],
};

function bilibiliFetch(play: Record<string, unknown> = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (init?.method === "HEAD") return new Response(null, { status: 200 });
    if (url.includes("/x/web-interface/view")) return json(view);
    if (url.includes("/x/player/wbi/playurl"))
      return json({
        accept_quality: [16, 32, 64, 80, 112],
        dash: {
          video: [
            { id: 112, baseUrl: "https://cdn.test/v112" },
            { id: 80, baseUrl: "https://cdn.test/v80", backupUrl: ["https://bak.test/v80"] },
          ],
          audio: [
            { id: 30216, baseUrl: "https://cdn.test/a-low" },
            { id: 30280, baseUrl: "https://cdn.test/a-high" },
          ],
        },
        ...play,
      });
    throw new Error(`unexpected ${url}`);
  });
}

it("识别视频页、短链与 av 号，不匹配其他网站", () => {
  expect(isBilibiliUrl("https://www.bilibili.com/video/BV1xx411c7mD")).toBe(true);
  expect(isBilibiliUrl("https://b23.tv/abc")).toBe(true);
  expect(isBilibiliUrl("https://www.youtube.com/watch?v=1")).toBe(false);
  expect(parseVideoUrl("https://www.bilibili.com/video/BV1xx411c7mD?p=2")).toEqual({
    bvid: "BV1xx411c7mD",
    page: 2,
  });
  expect(parseVideoUrl("https://www.bilibili.com/video/av170001")?.bvid).toBe(av2bv(170001));
});

it("解析分 P 标题与清晰度，未登录默认不超过 720P", async () => {
  const fetcher = bilibiliFetch();
  const instance = createBilibiliInstance({}, fetcher);
  const result = await instance.resolve(
    "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
    signal()
  );
  expect(result.title).toBe("费曼学习法 - 第二讲");
  expect(result.variants.map(item => item.ref)).toContainEqual({
    bvid: "BV1xx411c7mD",
    cid: "200",
    quality: 80,
  });
  expect(result.variants[0]).toMatchObject({ label: "1080P+ 高码率", hint: "大会员" });
  expect(result.variants[result.defaultVariant!].ref.quality).toBe(64);
  const headers = fetcher.mock.calls[0][1]?.headers as Record<string, string>;
  expect(headers.Cookie).toBeUndefined();
});

it("登录凭据写入 Cookie，大会员默认最高清晰度", async () => {
  const fetcher = bilibiliFetch();
  const instance = createBilibiliInstance(
    { SESSDATA: "sess", bfe_id: "bfe", user: { name: "u", avatar: "", vipStatus: 1 } },
    fetcher
  );
  const result = await instance.resolve("https://www.bilibili.com/video/BV1xx411c7mD", signal());
  expect(result.variants[result.defaultVariant!].ref.quality).toBe(112);
  const headers = fetcher.mock.calls[0][1]?.headers as Record<string, string>;
  expect(headers.Cookie).toBe("SESSDATA=sess;bfe_id=bfe");
});

it("播放源为带 Referer 的音视频分离流，历史数据缺清晰度按 1080P", async () => {
  const fetcher = bilibiliFetch();
  const instance = createBilibiliInstance({}, fetcher);
  const legacyRef = { bvid: "BV1xx411c7mD", cid: "100" };
  expect(instance.cacheKey(legacyRef)).toBe("BV1xx411c7mD-100-80");
  const playback = await instance.getPlayback(legacyRef, signal());
  expect(playback).toMatchObject({
    kind: "split",
    video: { url: "https://cdn.test/v80", headers: { Referer: "https://www.bilibili.com/" } },
    audio: { url: "https://cdn.test/a-high" },
  });
  expect(String(fetcher.mock.calls[0][0])).toContain("qn=80");
  expect(() => instance.cacheKey({})).toThrow("重新添加");
});

it("首个视频流不可用时改用备用地址；没有可用流时明确报错", async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (init?.method === "HEAD")
      return new Response(null, { status: String(input).includes("bak.test") ? 200 : 403 });
    return bilibiliFetch()(input, init);
  });
  const playback = await createBilibiliInstance({}, fetcher).getPlayback(
    { bvid: "BV1xx411c7mD", cid: "100", quality: 80 },
    signal()
  );
  expect(playback).toMatchObject({ video: { url: "https://bak.test/v80" } });
  const empty = bilibiliFetch({ dash: { video: [], audio: [] } });
  await expect(
    createBilibiliInstance({}, empty).getPlayback({ bvid: "BV1", cid: "1" }, signal())
  ).rejects.toThrow("大会员");
});

it("扫码成功后从第一跳 Set-Cookie 取得凭据，不跟随跳转", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    const headers = new Headers();
    headers.append("set-cookie", "SESSDATA=abc; Path=/; HttpOnly");
    headers.append("set-cookie", "bfe_id=xyz; Path=/");
    return new Response(null, { status: 302, headers });
  });
  await expect(
    credentialsFromQr(fetcher, "https://passport.biligame.com/crossDomain?ticket=1")
  ).resolves.toEqual({ SESSDATA: "abc", bfe_id: "xyz" });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
});
