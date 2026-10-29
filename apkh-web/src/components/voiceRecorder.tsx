"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { transcribeRecording } from "@/services/noteService";
import { getErrorMessage } from "@/services/axios";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { FormAlert } from "@/components/authShell";
import { useI18n } from "@/i18n";

// Long enough for a meeting summary; well under the 20 MB the server takes.
const MAX_SECONDS = 15 * 60;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

/** Minimal Web Speech API types (not in TypeScript's DOM library). */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function speechRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as Record<string, (new () => SpeechRecognitionLike) | undefined>;
  const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Recognition ? new Recognition() : null;
}

function extensionFor(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function fileName(mimeType: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `voice-note-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.${extensionFor(mimeType)}`;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

type Phase = "starting" | "recording" | "transcribing" | "review" | "error";

interface VoiceRecorderProps {
  open: boolean;
  onClose: () => void;
  /** The recording (attached to the note) and its transcript ("" when there is none) */
  onDone: (recording: File, transcript: string) => void;
}

/**
 * Records a voice note. The server transcribes it with the user's AI (or
 * Whisper); where it can't, the browser's own speech recognition, which
 * listens along while recording, supplies the transcript.
 */
export function VoiceRecorder({ open, onClose, onDone }: VoiceRecorderProps) {
  const { t, language } = useI18n();
  const [phase, setPhase] = useState<Phase>("starting");
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTextRef = useRef("");
  const recordingRef = useRef<File | null>(null);
  const cancelledRef = useRef(false);
  // Read through refs so a parent re-render doesn't restart the recording.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const tRef = useRef(t);
  tRef.current = t;
  const languageRef = useRef(language);
  languageRef.current = language;

  const release = useCallback(() => {
    const speech = speechRef.current;
    speechRef.current = null;
    if (speech) {
      speech.onend = null;
      try {
        speech.stop();
      } catch {
        // already stopped
      }
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const finish = useCallback(
    async (recording: File) => {
      const t = tRef.current;
      setPhase("transcribing");
      const browserText = finalTextRef.current.trim();
      let text = "";
      let note: string | null = null;
      try {
        const result = await transcribeRecording(recording);
        text = result.text.trim();
        if (!result.available) note = browserText ? null : t("voice.noTranscriber");
      } catch (error) {
        note = browserText ? null : getErrorMessage(error, t("voice.transcribeFailed"));
      }
      if (cancelledRef.current) return;
      const transcript = text || browserText;
      if (transcript) {
        onDoneRef.current(recording, transcript);
        return;
      }
      recordingRef.current = recording;
      setMessage(note ?? t("voice.nothingHeard"));
      setPhase("review");
    },
    [],
  );

  // Start when opened; stop everything when closed.
  useEffect(() => {
    if (!open) return;
    cancelledRef.current = false;
    finalTextRef.current = "";
    recordingRef.current = null;
    setPhase("starting");
    setSeconds(0);
    setLive("");
    setMessage(null);

    let stopped = false;
    (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        if (stopped) return;
        setMessage(tRef.current("voice.micBlocked"));
        setPhase("error");
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48_000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onstop = () => {
        release();
        if (cancelledRef.current) return;
        const type = recorder.mimeType || mimeType || "audio/webm";
        void finish(new File([new Blob(chunks, { type })], fileName(type), { type: type.split(";")[0] }));
      };
      recorderRef.current = recorder;
      recorder.start(1000);
      setPhase("recording");

      const speech = speechRecognition();
      if (speech) {
        const language = languageRef.current;
        speech.lang = language === "en" ? navigator.language || "en-US" : language;
        speech.continuous = true;
        speech.interimResults = true;
        speech.onresult = (event) => {
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) finalTextRef.current += `${result[0].transcript.trim()} `;
            else interim += result[0].transcript;
          }
          setLive(`${finalTextRef.current}${interim}`.trim());
        };
        // Browsers stop listening after a pause; keep going while recording.
        speech.onend = () => {
          if (speechRef.current === speech && recorder.state === "recording") {
            try {
              speech.start();
            } catch {
              // restarting too fast; the recording still has everything
            }
          }
        };
        speech.onerror = () => {};
        speechRef.current = speech;
        try {
          speech.start();
        } catch {
          speechRef.current = null;
        }
      }
    })();

    return () => {
      stopped = true;
      cancelledRef.current = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      recorderRef.current = null;
      release();
    };
  }, [open, finish, release]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (seconds >= MAX_SECONDS) stop();
  }, [seconds, stop]);

  return (
    <Modal open={open} onClose={onClose} locked={phase === "transcribing"} size="sm" title={t("voice.title")}>
      <div className="flex flex-col items-center px-5 pb-6 text-center sm:px-6">
        {phase === "error" ? (
          <div className="w-full text-left">
            <FormAlert>{message}</FormAlert>
          </div>
        ) : phase === "review" ? (
          <>
            <div className="w-full text-left">
              <FormAlert tone="info">{message}</FormAlert>
            </div>
            <div className="mt-5 flex w-full justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                {t("voice.discard")}
              </Button>
              <Button onClick={() => recordingRef.current && onDone(recordingRef.current, "")}>{t("voice.attachOnly")}</Button>
            </div>
          </>
        ) : (
          <>
            <span className="relative mt-2 flex size-20 items-center justify-center">
              {phase === "recording" && <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/25" />}
              <span className="relative flex size-16 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg shadow-rose-500/30">
                {phase === "transcribing" ? <Spinner className="size-6" /> : <Mic className="size-7" />}
              </span>
            </span>
            <p className="mt-4 font-mono text-2xl text-fg tabular-nums">{clock(seconds)}</p>
            <p className="mt-1 text-sm text-fg-muted">
              {phase === "starting" ? t("voice.starting") : phase === "transcribing" ? t("voice.transcribing") : t("voice.recording", { max: MAX_SECONDS / 60 })}
            </p>
            {live && <p className="mt-4 max-h-32 w-full overflow-y-auto rounded-xl bg-surface-2 p-3 text-left text-sm text-fg-muted">{live}</p>}
            <div className="mt-5 flex w-full justify-center gap-2">
              <Button variant="ghost" onClick={onClose} disabled={phase === "transcribing"}>
                {t("common.cancel")}
              </Button>
              <Button onClick={stop} disabled={phase !== "recording"} icon={<Square className="size-3.5 fill-current" />}>
                {t("voice.stop")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
