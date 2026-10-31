import type { JsonValue, VideoInstance, VideoRef, VideoVariant } from "@tau/plugins";
import {
  QUALITY_LABELS,
  STREAM_HEADERS,
  getPlayUrl,
  getCaptions,
  getVideoInfo,
  isBilibiliUrl,
  type Credentials,
  type Fetch,
} from "./api";

export interface BilibiliConfig extends Credentials {
  user?: { name: string; avatar: string; vipStatus: number };
}

/** 历史数据未记录清晰度时按 1080P 处理。 */
const DEFAULT_QUALITY = 80;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function readConfig(value: JsonValue): BilibiliConfig {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const user = record.user as BilibiliConfig["user"] | undefined;
  return {
    SESSDATA: text(record.SESSDATA),
    bfe_id: text(record.bfe_id),
    ...(user && typeof user === "object"
      ? {
          user: {
            name: text(user.name),
            avatar: text(user.avatar),
            vipStatus: typeof user.vipStatus === "number" ? user.vipStatus : 0,
          },
        }
      : {}),
  };
}

function readRef(ref: VideoRef) {
  const bvid = text(ref.bvid);
  const cid = typeof ref.cid === "number" ? String(ref.cid) : text(ref.cid);
  if (!bvid || !cid) throw new Error("缺少 Bilibili 视频信息，请重新添加视频");
  const quality = typeof ref.quality === "number" ? ref.quality : DEFAULT_QUALITY;
  return { bvid, cid, quality };
}

/** 未登录最高 720P、登录最高 1080P，大会员取最高档。 */
function defaultQuality(qualities: number[], config: BilibiliConfig): number {
  if (config.SESSDATA && config.user?.vipStatus) return qualities[0];
  const limit = config.SESSDATA ? 80 : 64;
  return qualities.find(quality => quality <= limit) ?? qualities[qualities.length - 1];
}

const qualityHint = (quality: number) =>
  quality >= 100 ? "大会员" : quality >= 74 ? "需登录" : undefined;

export function createBilibiliInstance(value: JsonValue, fetcher: Fetch): VideoInstance {
  const config = readConfig(value);
  return {
    matches: isBilibiliUrl,
    async resolve(url, signal) {
      const info = await getVideoInfo(fetcher, url, config, signal);
      const qualities = [...new Set(info.acceptQuality)].sort((a, b) => b - a);
      if (!qualities.length) throw new Error("未找到可用的清晰度");
      const variants: VideoVariant[] = qualities.map(quality => ({
        label: QUALITY_LABELS[quality] ?? `清晰度 ${quality}`,
        hint: qualityHint(quality),
        ref: { bvid: info.bvid, cid: info.cid, quality },
      }));
      return {
        title: info.title,
        cover: info.cover,
        variants,
        defaultVariant: qualities.indexOf(defaultQuality(qualities, config)),
      };
    },
    cacheKey(ref) {
      const { bvid, cid, quality } = readRef(ref);
      return `${bvid}-${cid}-${quality}`;
    },
    async getPlayback(ref, signal) {
      const { bvid, cid, quality } = readRef(ref);
      const urls = await getPlayUrl(fetcher, bvid, cid, quality, config, signal);
      return {
        kind: "split",
        video: { url: urls.video, headers: STREAM_HEADERS },
        audio: { url: urls.audio, headers: STREAM_HEADERS },
      };
    },
    getCaptions(ref, signal) {
      const { bvid, cid } = readRef(ref);
      return getCaptions(fetcher, bvid, cid, config, signal);
    },
  };
}
