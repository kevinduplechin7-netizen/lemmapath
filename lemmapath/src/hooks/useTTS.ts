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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [unlocked, setUnlocked] = useState(!isIOS());
  const currentTextRef = useRef<string>("");

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const prime = useCallback(() => {
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      setUnlocked(true);
    } catch {
      setUnlocked(true);
    }
  }, []);

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

      if (!text.trim()) return;
      if (isIOS() && !unlocked) return;

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
    [pickVoice, unlocked]
  );

  const stop = useCallback(() => window.speechSynthesis.cancel(), []);

  return {
    voices,
    unlocked,
    prime,
    speak,
    stop,
    isIOS: isIOS()
  };
}
