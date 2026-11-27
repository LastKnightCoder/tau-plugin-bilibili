import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Button, Input } from "@tau/ui";
import { definePlugin, useI18n, type PluginContext, type PluginSettingsProps } from "@tau/plugins";
import { QR_STATUS, checkLogin, credentialsFromQr, getQrCode, pollQrCode } from "./api";
import { createBilibiliInstance, readConfig, type BilibiliConfig } from "./provider";
import { messages } from "./i18n";

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
  const { t } = useI18n(messages);
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
          setStatus(t("login.qr.expired"));
        } else if (result.code === QR_STATUS.NOT_CONFIRMED) {
          setStatus(t("login.qr.scanned"));
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
    setStatus(t("login.qr.fetching"));
    try {
      const { key, url } = await getQrCode(context.fetch);
      if (current !== generation.current) return;
      setQr({ key, image: qrImage(url) });
      setStatus(t("login.qr.prompt"));
    } catch (error) {
      if (current === generation.current)
        setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return { qr, status, expired, start };
}

function BilibiliSettings({ context, videoConfig }: PluginSettingsProps) {
  const { t } = useI18n(messages);
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
  const login = useQrLogin(context, next => void save(next, t("login.saved")));

  if (!videoConfig) return null;

  const verify = async () => {
    const credentials = { SESSDATA: sessdata.trim(), bfe_id: bfeId.trim() };
    if (!credentials.SESSDATA) {
      setMessage(t("login.manual.sessdataRequired"));
      return;
    }
    setSaving(true);
    try {
      const user = await checkLogin(context.fetch, credentials);
      if (!user.isLogin) throw new Error(t("login.manual.invalid"));
      await save(
        { ...credentials, user: { name: user.name, avatar: user.avatar, vipStatus: user.vipStatus } },
        t("login.saved")
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
          <span className="font-medium">{config.user?.name || t("login.saved")}</span>
          <span className="opacity-70">
            {config.user?.vipStatus ? t("login.account.vip") : t("login.account.normal")}
          </span>
        </div>
        <p className="opacity-70">{t("login.account.hint")}</p>
        <div>
          <Button
            size="sm"
            variant="secondary"
            loading={saving}
            onClick={() => void save({}, t("login.logout.done"))}
          >
            {t("login.logout.button")}
          </Button>
        </div>
        {message && <p role="status">{message}</p>}
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <p className="opacity-70">{t("login.intro")}</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === "qrcode" ? "primary" : "secondary"}
          onClick={() => setMode("qrcode")}
        >
          {t("login.mode.qrcode")}
        </Button>
        <Button
          size="sm"
          variant={mode === "manual" ? "primary" : "secondary"}
          onClick={() => setMode("manual")}
        >
          {t("login.mode.manual")}
        </Button>
      </div>
      {mode === "qrcode" ? (
        <div className="flex flex-col items-start gap-2">
          {login.qr && (
            <img
              src={login.qr.image}
              alt={t("login.qr.alt")}
              className="size-[180px]"
              style={{ opacity: login.expired ? 0.4 : 1 }}
            />
          )}
          {login.status && <p role="status">{login.status}</p>}
          <Button size="sm" variant="secondary" onClick={() => void login.start()}>
            {login.qr ? t("login.qr.refresh") : t("login.qr.get")}
          </Button>
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            {t("login.manual.sessdataLabel")}
            <Input
              type="password"
              value={sessdata}
              autoComplete="off"
              onChange={event => setSessdata(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            {t("login.manual.bfeIdLabel")}
            <Input value={bfeId} spellCheck={false} onChange={event => setBfeId(event.target.value)} />
          </label>
          <p className="opacity-70">{t("login.manual.hint")}</p>
          <div>
            <Button size="sm" variant="primary" loading={saving} onClick={() => void verify()}>
              {t("login.manual.verify")}
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
  i18n: messages,
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
