import { useCallback, useEffect, useRef, useState } from "react";

type SpeakOpts = {
  lang: string;
  rate: number;
  pitch: number;
  voiceURI?: string;
};

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

export function useTTS() {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  const ios = isIOS();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [unlocked, setUnlocked] = useState(!ios);
  const currentTextRef = useRef<string>("");

  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [supported]);

  const prime = useCallback(() => {
    if (!supported) return;
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      setUnlocked(true);
    } catch {
      setUnlocked(true);
    }
  }, [supported]);

  const pickVoice = useCallback(
    (opts: SpeakOpts) => {
      if (!voices.length) return undefined;
      if (opts.voiceURI) {
        const v = voices.find((vv) => vv.voiceURI === opts.voiceURI);
        if (v) return v;
      }
      const byLang = voices.filter((v) => (v.lang || "").toLowerCase().startsWith(opts.lang.toLowerCase()));
      return byLang[0] ?? voices[0];
    },
    [voices]
  );

  const speak = useCallback(
    (text: string, opts: SpeakOpts) => {
      currentTextRef.current = text;

      if (!supported) return;

      if (!text.trim()) return;
      if (ios && !unlocked) return;

      try {
        (window.speechSynthesis as any).resume?.();
      } catch {
        // ignore
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = opts.lang;
      u.rate = opts.rate;
      u.pitch = opts.pitch;
      const voice = pickVoice(opts);
      if (voice) u.voice = voice;

      const latest = currentTextRef.current;
      if (latest !== text) return;

      window.speechSynthesis.speak(u);
    },
    [pickVoice, unlocked, ios, supported]
  );

  const speakAsync = useCallback(
    (text: string, opts: SpeakOpts) => {
      currentTextRef.current = text;

      return new Promise<void>((resolve) => {
        if (!supported) return resolve();
        if (!text.trim()) return resolve();
        if (ios && !unlocked) return resolve();

        try {
          (window.speechSynthesis as any).resume?.();
        } catch {
          // ignore
        }

        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = opts.lang;
        u.rate = opts.rate;
        u.pitch = opts.pitch;
        const voice = pickVoice(opts);
        if (voice) u.voice = voice;

        const latest = currentTextRef.current;
        if (latest !== text) return resolve();

        // Safety: some browsers fail silently and never call onend/onerror.
        const timeoutMs = Math.max(6000, Math.min(45000, Math.ceil(text.length * 160)));
        const t = window.setTimeout(() => resolve(), timeoutMs);

        u.onend = () => {
          window.clearTimeout(t);
          resolve();
        };
        u.onerror = () => {
          window.clearTimeout(t);
          resolve();
        };

        window.speechSynthesis.speak(u);
      });
    },
    [pickVoice, unlocked, ios, supported]
  );

  const stop = useCallback(() => {
    if (!supported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }, [supported]);

  return {
    voices,
    unlocked,
    supported,
    prime,
    speak,
    speakAsync,
    stop,
    isIOS: ios
  };
}
