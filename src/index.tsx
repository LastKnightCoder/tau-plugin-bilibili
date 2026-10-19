import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Button, Input } from "@tau/ui";
import { definePlugin, type PluginContext, type PluginSettingsProps } from "@tau/plugins";
import { QR_STATUS, checkLogin, credentialsFromQr, getQrCode, pollQrCode } from "./api";
import { createBilibiliInstance, readConfig, type BilibiliConfig } from "./provider";

declare const __PLUGIN_META__: { id: string; name: string; version: string };

const POLL_INTERVAL = 2000;

/** 二维码在本地生成：登录链接含扫码凭据，不能交给第三方服务渲染。 */
function qrImage(url: string) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createDataURL(5, 2);
}

function useQrLogin(context: PluginContext, onCredentials: (config: BilibiliConfig) => void) {
  const [qr, setQr] = useState<{ image: string; key: string } | null>(null);
  const [status, setStatus] = useState("");
  const [expired, setExpired] = useState(false);
  const generation = useRef(0);

  useEffect(() => () => void (generation.current += 1), []);

  useEffect(() => {
    if (!qr || expired) return;
    const current = generation.current;
    const timer = setInterval(async () => {
      try {
        const result = await pollQrCode(context.fetch, qr.key);
        if (current !== generation.current || context.signal.aborted) return;
        if (result.code === QR_STATUS.SUCCESS && result.url) {
          clearInterval(timer);
          const credentials = await credentialsFromQr(context.fetch, result.url);
          const user = await checkLogin(context.fetch, credentials);
          if (current === generation.current)
            onCredentials({
              ...credentials,
              user: { name: user.name, avatar: user.avatar, vipStatus: user.vipStatus },
            });
        } else if (result.code === QR_STATUS.EXPIRED) {
          setExpired(true);
          setStatus("二维码已过期，请刷新");
        } else if (result.code === QR_STATUS.NOT_CONFIRMED) {
          setStatus("已扫码，请在手机上确认登录");
        }
      } catch (error) {
        if (current === generation.current)
          setStatus(error instanceof Error ? error.message : String(error));
      }
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [qr, expired, context, onCredentials]);

  const start = async () => {
    generation.current += 1;
    const current = generation.current;
    setExpired(false);
    setStatus("正在获取二维码…");
    try {
      const { key, url } = await getQrCode(context.fetch);
      if (current !== generation.current) return;
      setQr({ key, image: qrImage(url) });
      setStatus("使用 Bilibili 手机客户端扫码登录");
    } catch (error) {
      if (current === generation.current)
        setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return { qr, status, expired, start };
}

function BilibiliSettings({ context, videoConfig }: PluginSettingsProps) {
  const config = readConfig(videoConfig?.value ?? {});
  const [mode, setMode] = useState<"qrcode" | "manual">("qrcode");
  const [sessdata, setSessdata] = useState(config.SESSDATA ?? "");
  const [bfeId, setBfeId] = useState(config.bfe_id ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const save = async (next: BilibiliConfig, success: string) => {
    if (!videoConfig) return;
    setSaving(true);
    setMessage("");
    try {
      await videoConfig.save(next as unknown as import("@tau/plugins").JsonValue);
      if (!context.signal.aborted) setMessage(success);
    } catch (error) {
      if (!context.signal.aborted) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!context.signal.aborted) setSaving(false);
    }
  };
  const login = useQrLogin(context, next => void save(next, "已登录"));

  if (!videoConfig) return null;

  const verify = async () => {
    const credentials = { SESSDATA: sessdata.trim(), bfe_id: bfeId.trim() };
    if (!credentials.SESSDATA) {
      setMessage("请输入 SESSDATA");
      return;
    }
    setSaving(true);
    try {
      const user = await checkLogin(context.fetch, credentials);
      if (!user.isLogin) throw new Error("凭据无效，请检查 SESSDATA");
      await save(
        { ...credentials, user: { name: user.name, avatar: user.avatar, vipStatus: user.vipStatus } },
        "已登录"
      );
    } catch (error) {
      if (!context.signal.aborted) {
        setMessage(error instanceof Error ? error.message : String(error));
        setSaving(false);
      }
    }
  };

  if (config.SESSDATA)
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          {config.user?.avatar && (
            <img
              src={config.user.avatar}
              alt=""
              referrerPolicy="no-referrer"
              className="size-8 rounded-full"
            />
          )}
          <span className="font-medium">{config.user?.name || "已登录"}</span>
          <span className="opacity-70">{config.user?.vipStatus ? "大会员" : "普通用户"}</span>
        </div>
        <p className="opacity-70">登录后可选择更高清晰度；大会员可使用 1080P+ 与 4K。</p>
        <div>
          <Button size="sm" variant="secondary" loading={saving} onClick={() => void save({}, "已退出登录")}>
            退出登录
          </Button>
        </div>
        {message && <p role="status">{message}</p>}
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <p className="opacity-70">未登录也可以添加视频，默认最高 720P；登录后可选择更高清晰度。</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === "qrcode" ? "primary" : "secondary"}
          onClick={() => setMode("qrcode")}
        >
          扫码登录
        </Button>
        <Button
          size="sm"
          variant={mode === "manual" ? "primary" : "secondary"}
          onClick={() => setMode("manual")}
        >
          手动填写
        </Button>
      </div>
      {mode === "qrcode" ? (
        <div className="flex flex-col items-start gap-2">
          {login.qr && (
            <img
              src={login.qr.image}
              alt="Bilibili 登录二维码"
              className="size-[180px]"
              style={{ opacity: login.expired ? 0.4 : 1 }}
            />
          )}
          {login.status && <p role="status">{login.status}</p>}
          <Button size="sm" variant="secondary" onClick={() => void login.start()}>
            {login.qr ? "刷新二维码" : "获取二维码"}
          </Button>
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            SESSDATA
            <Input
              type="password"
              value={sessdata}
              autoComplete="off"
              onChange={event => setSessdata(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            bfe_id（可选）
            <Input value={bfeId} spellCheck={false} onChange={event => setBfeId(event.target.value)} />
          </label>
          <p className="opacity-70">在浏览器登录 bilibili.com 后，于开发者工具的 Cookies 中找到 SESSDATA。</p>
          <div>
            <Button size="sm" variant="primary" loading={saving} onClick={() => void verify()}>
              验证并保存
            </Button>
          </div>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}

export default definePlugin({
  id: __PLUGIN_META__.id,
  name: __PLUGIN_META__.name,
  version: __PLUGIN_META__.version,
  create: () => ({
    activate(context) {
      if (!context.video) throw new Error("当前客户端不支持视频网站插件，请升级 Tau");
      context.video.register({
        id: context.pluginId,
        name: "Bilibili",
        create: config => createBilibiliInstance(config, context.fetch),
      });
      context.settings.register({
        id: "account",
        title: "Bilibili",
        target: "video",
        component: BilibiliSettings,
      });
    },
  }),
});
