/** Bilibili Web 接口：视频信息、清晰度、播放地址与扫码登录。网络请求一律经插件 fetch。 */

export interface Credentials {
  SESSDATA?: string;
  bfe_id?: string;
}

export interface UserInfo {
  name: string;
  avatar: string;
  isLogin: boolean;
  vipStatus: number;
}

export interface VideoInfo {
  bvid: string;
  cid: string;
  title: string;
  cover: string;
  acceptQuality: number[];
}

export interface PlayUrl {
  video: string;
  audio: string;
}

const API = "https://api.bilibili.com";
const WEB = "https://www.bilibili.com";
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
/** 视频流 CDN 校验 Referer，下载时必须携带。 */
export const STREAM_HEADERS = { Referer: `${WEB}/`, "User-Agent": USER_AGENT };

export const QUALITY_LABELS: Record<number, string> = {
  6: "240P 极速",
  16: "360P 流畅",
  32: "480P 清晰",
  64: "720P 高清",
  74: "720P60 高帧率",
  80: "1080P 高清",
  100: "智能修复",
  112: "1080P+ 高码率",
  116: "1080P60 高帧率",
  120: "4K 超清",
  125: "HDR 真彩色",
  126: "杜比视界",
  127: "8K 超高清",
};

export type Fetch = typeof globalThis.fetch;

export function createHeaders(credentials?: Credentials): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Referer: `${WEB}/`,
    Origin: WEB,
  };
  if (credentials?.SESSDATA) {
    headers.Cookie = `SESSDATA=${credentials.SESSDATA}${
      credentials.bfe_id ? `;bfe_id=${credentials.bfe_id}` : ""
    }`;
  }
  return headers;
}

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

async function getJson<T>(
  fetcher: Fetch,
  url: string,
  credentials: Credentials | undefined,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetcher(url, { headers: createHeaders(credentials), signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Bilibili 请求失败：HTTP ${response.status}`);
  }
  const data = (await response.json()) as ApiResponse<T>;
  if (data.code !== 0) throw new Error(data.message || `Bilibili 接口错误：${data.code}`);
  return data.data;
}

export function isBilibiliUrl(url: string): boolean {
  return /^https?:\/\/(?:([\w-]+\.)?bilibili\.com|b23\.tv)\/.+/i.test(url);
}

const TABLE = "fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF";

export function av2bv(aid: number): string {
  const bytes = ["B", "V", "1", "", "", "", "", "", "", "", "", ""];
  let index = (BigInt(aid) ^ 23442827791579n) & 2251799813685247n;
  for (let i = 0; i < 6; i++) {
    bytes[11 - i] = TABLE[Number(index % 58n)];
    index = index / 58n;
  }
  [bytes[3], bytes[9]] = [bytes[9], bytes[3]];
  [bytes[4], bytes[7]] = [bytes[7], bytes[4]];
  return bytes.join("");
}

/** 从视频页地址解析 BV 号与分 P；av 号转换为 BV 号。 */
export function parseVideoUrl(url: string): { bvid: string; page: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const page = Number.parseInt(parsed.searchParams.get("p") || "1", 10) || 1;
  const bv = parsed.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);
  if (bv) return { bvid: bv[1], page };
  const av = parsed.pathname.match(/\/video\/av(\d+)/i);
  if (av) return { bvid: av2bv(Number(av[1])), page };
  return null;
}

/** b23.tv 短链等非视频页地址：跟随跳转，或从页面中找到视频页地址。 */
async function resolveVideoPage(
  fetcher: Fetch,
  url: string,
  credentials: Credentials | undefined,
  signal?: AbortSignal
): Promise<string> {
  if (parseVideoUrl(url)) return url;
  const response = await fetcher(url, { headers: createHeaders(credentials), signal });
  if (parseVideoUrl(response.url)) {
    await response.body?.cancel();
    return response.url;
  }
  const html = (await response.text()).replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  const match = html.match(/(?:https?:)?\/\/www\.bilibili\.com\/video\/(?:BV[0-9A-Za-z]+|av\d+)/i);
  if (match) return match[0].startsWith("//") ? `https:${match[0]}` : match[0];
  throw new Error("无法从链接中找到 Bilibili 视频，目前支持视频页与 b23.tv 短链");
}

interface ViewData {
  bvid: string;
  cid: number;
  title: string;
  pic: string;
  pages: { cid: number; page: number; part: string }[];
}

interface PlayData {
  accept_quality: number[];
  dash?: {
    video: { id: number; baseUrl: string; backupUrl?: string[] }[];
    audio: { id: number; baseUrl: string; backupUrl?: string[] }[] | null;
  };
}

const playUrl = (bvid: string, cid: string, quality: number) =>
  `${API}/x/player/wbi/playurl?cid=${cid}&bvid=${bvid}&qn=${quality}&type=&otype=json&fourk=1&fnver=0&fnval=80`;

export async function getVideoInfo(
  fetcher: Fetch,
  url: string,
  credentials?: Credentials,
  signal?: AbortSignal
): Promise<VideoInfo> {
  const parsed = parseVideoUrl(await resolveVideoPage(fetcher, url, credentials, signal));
  if (!parsed) throw new Error("无法解析 Bilibili 视频链接");
  const view = await getJson<ViewData>(
    fetcher,
    `${API}/x/web-interface/view?bvid=${parsed.bvid}`,
    credentials,
    signal
  );
  const part = view.pages.find(page => page.page === parsed.page);
  const cid = String(part?.cid ?? view.cid);
  const quality = await getJson<PlayData>(
    fetcher,
    playUrl(view.bvid, cid, 127),
    credentials,
    signal
  );
  return {
    bvid: view.bvid,
    cid,
    title: part && parsed.page > 1 && part.part ? `${view.title} - ${part.part}` : view.title,
    cover: view.pic,
    acceptQuality: quality.accept_quality ?? [],
  };
}

async function firstAvailable(
  fetcher: Fetch,
  urls: string[],
  signal?: AbortSignal
): Promise<string | undefined> {
  for (const url of urls) {
    try {
      const response = await fetcher(url, { method: "HEAD", headers: STREAM_HEADERS, signal });
      if (response.ok) return url;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return undefined;
}

const candidates = (streams: { baseUrl: string; backupUrl?: string[] }[]) =>
  streams.flatMap(stream => [stream.baseUrl, ...(stream.backupUrl ?? [])]);

/** DASH 播放地址：音频取最高档，视频优先匹配所选清晰度，均探测可用后选取。 */
export async function getPlayUrl(
  fetcher: Fetch,
  bvid: string,
  cid: string,
  quality: number,
  credentials?: Credentials,
  signal?: AbortSignal
): Promise<PlayUrl> {
  const data = await getJson<PlayData>(fetcher, playUrl(bvid, cid, quality), credentials, signal);
  const video = data.dash?.video ?? [];
  const audio = [...(data.dash?.audio ?? [])].sort((a, b) => b.id - a.id);
  if (!video.length || !audio.length) throw new Error("视频流不可用，可能需要大会员权限或视频已失效");
  const matching = video.filter(stream => stream.id === quality);
  return {
    video:
      (await firstAvailable(fetcher, candidates(matching.length ? matching : video), signal)) ??
      video[0].baseUrl,
    audio: (await firstAvailable(fetcher, candidates(audio), signal)) ?? audio[0].baseUrl,
  };
}

export async function checkLogin(fetcher: Fetch, credentials: Credentials): Promise<UserInfo> {
  type Nav = { isLogin: boolean; uname?: string; face?: string; vipStatus?: number };
  const data = await getJson<Nav>(fetcher, `${API}/x/web-interface/nav`, credentials).catch(
    (error): Nav => {
      // 未登录时 nav 接口返回非 0 code
      if (credentials.SESSDATA) throw error;
      return { isLogin: false };
    }
  );
  return {
    name: data.uname ?? "",
    avatar: data.face ?? "",
    isLogin: data.isLogin,
    vipStatus: data.vipStatus ?? 0,
  };
}

export const QR_STATUS = {
  SUCCESS: 0,
  EXPIRED: 86038,
  NOT_CONFIRMED: 86090,
  NOT_SCANNED: 86101,
} as const;

export async function getQrCode(fetcher: Fetch): Promise<{ key: string; url: string }> {
  const data = await getJson<{ qrcode_key: string; url: string }>(
    fetcher,
    "https://passport.bilibili.com/x/passport-login/web/qrcode/generate",
    undefined
  );
  return { key: data.qrcode_key, url: data.url };
}

export async function pollQrCode(
  fetcher: Fetch,
  key: string
): Promise<{ code: number; message: string; url?: string }> {
  const data = await getJson<{ code: number; message: string; url?: string }>(
    fetcher,
    `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}&source=main-fe-header&web_location=333.1007`,
    undefined
  );
  return data;
}

function readCookies(values: string[]): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const value of values) {
    const [pair] = value.split(";");
    const index = pair.indexOf("=");
    if (index > 0) cookies[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return cookies;
}

/** 扫码成功后的跨域票据：凭据在第一跳 302 的 Set-Cookie 中下发，不能跟随跳转。 */
export async function credentialsFromQr(fetcher: Fetch, url: string): Promise<Credentials> {
  const params = new URL(url).searchParams;
  if (params.get("SESSDATA"))
    return { SESSDATA: params.get("SESSDATA") ?? "", bfe_id: params.get("bfe_id") ?? "" };
  const response = await fetcher(url, {
    headers: { "User-Agent": USER_AGENT, Referer: "https://passport.bilibili.com/" },
    redirect: "manual",
  });
  const cookies = readCookies(response.headers.getSetCookie());
  await response.body?.cancel();
  if (!cookies.SESSDATA) throw new Error("未能获取登录凭据，请重新扫码");
  return { SESSDATA: cookies.SESSDATA, bfe_id: cookies.bfe_id ?? "" };
}
