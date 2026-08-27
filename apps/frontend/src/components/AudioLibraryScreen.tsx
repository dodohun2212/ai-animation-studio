import { useEffect, useRef, useState } from "react";
import type { AudioLibraryTrack } from "@ai-animation-studio/shared";

import { audioTrackContentUrl, deleteAudioTrack, getAudioLibrary, toAudioLibraryDisplayError, uploadAudioTrack } from "../api/audioLibraryApi.js";
import { Spinner } from "./Spinner.js";

interface Props {
  onBack: () => void;
}

type DisplayError = { code: string; message: string };
type State =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; tracks: AudioLibraryTrack[] };

const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

/** Accepted by the server; stated here too so the picker does not offer files it will reject. */
const ACCEPTED = ".mp3,.wav,.m4a,.ogg,audio/mpeg,audio/wav,audio/mp4,audio/ogg";

type LicenseKind = AudioLibraryTrack["licenseKind"];

/**
 * Plain descriptions rather than licence jargon: the person filling this in is not a lawyer, and picking wrong
 * is worse than picking slowly. `attributionRequired` follows from the choice for every kind whose answer is
 * fixed — only "other" is genuinely unknowable from the label alone, so only that one asks.
 */
const LICENSE_OPTIONS: { value: LicenseKind; label: string; attribution: boolean | "ask" }[] = [
  { value: "cc0", label: "CC0 · 퍼블릭 도메인 (조건 없음)", attribution: false },
  { value: "cc-by", label: "CC BY (출처 표시 필요)", attribution: true },
  { value: "purchased", label: "구매하거나 구독으로 받은 음원", attribution: false },
  { value: "self-made", label: "직접 만든 음원", attribution: false },
  { value: "other", label: "그 밖의 경우", attribution: "ask" },
];

export function trackDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The BGM library: music the user brings in themselves, kept apart from the Asset Library (input material fed to
 * the models) and the Video Library (finished results). Nothing here is generated and nothing is sent to a
 * provider — these are the user's own files, mixed in locally at merge time.
 *
 * There is deliberately no in-app search or download. No free-music service offers an API whose licence is clean
 * for commercial use without attribution, and wiring one up anyway would hand people tracks whose conditions they
 * would only discover after publishing (docs/06_DECISIONS.md D-001).
 */
export function AudioLibraryScreen({ onBack }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [licenseKind, setLicenseKind] = useState<LicenseKind | "">("");
  const [attributionRequired, setAttributionRequired] = useState(false);
  const [attributionText, setAttributionText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadError, setUploadError] = useState<DisplayError | null>(null);
  const [uploadedTitle, setUploadedTitle] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<DisplayError | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  function load(): void {
    setState({ status: "loading" });
    getAudioLibrary()
      .then((response) => setState({ status: "ready", tracks: response.tracks }))
      .catch((caught: unknown) => setState({ status: "error", error: toAudioLibraryDisplayError(caught) }));
  }

  useEffect(() => {
    load();
  }, []);

  async function upload(): Promise<void> {
    if (!file || !licenseKind || uploadPending) return;
    setUploadPending(true);
    setUploadError(null);
    setUploadedTitle(null);
    try {
      const response = await uploadAudioTrack(file, { title, artist, licenseKind, attributionRequired, attributionText, sourceUrl });
      setUploadedTitle(response.track.title);
      setTitle("");
      setArtist("");
      setLicenseKind("");
      setAttributionRequired(false);
      setAttributionText("");
      setSourceUrl("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      load();
    } catch (caught) {
      setUploadError(toAudioLibraryDisplayError(caught));
    } finally {
      setUploadPending(false);
    }
  }

  async function removeTrack(trackId: string): Promise<void> {
    if (deletePending) return;
    setDeletePending(trackId);
    setDeleteError(null);
    try {
      await deleteAudioTrack(trackId);
      setDeleteConfirm(null);
      load();
    } catch (caught) {
      setDeleteError(toAudioLibraryDisplayError(caught));
    } finally {
      setDeletePending(null);
    }
  }

  const tracks = state.status === "ready" ? state.tracks : [];
  const selectedLicense = LICENSE_OPTIONS.find((option) => option.value === licenseKind);

  return (
    <section className="mt-8 max-w-3xl space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>
        돌아가기
      </button>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        음원 보관함
      </h1>
      <p className="text-sm text-slate-400">
        여기 올린 음원은 최종 영상을 합칠 때 배경음악으로 넣을 수 있습니다. 나레이션이 있으면 그 위에 낮은 볼륨으로 깔립니다.
      </p>
      {/* Said once, up front, because the consequence lands after publishing — not while using this screen. */}
      <p data-testid="audio-license-notice" className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
        올리시는 음원의 사용 권한은 직접 확인해 주세요. 완성된 영상 파일 안에 음악이 들어가므로,
        인스타그램이나 유튜브에 올릴 때의 책임은 올린 사람에게 있습니다. 출처 표시가 필요한 음원이라면 캡션에 적어야 합니다.
      </p>

      <div className={cardSection}>
        <h2 className="text-sm font-semibold text-slate-200">음원 올리기</h2>
        <label className="block text-sm text-slate-300" htmlFor="audio-file">
          파일 (MP3, WAV, M4A, OGG · 50MB 이하)
          <input
            id="audio-file"
            data-testid="audio-file-input"
            ref={fileInput}
            type="file"
            accept={ACCEPTED}
            className={fieldClassName}
            disabled={uploadPending}
            onChange={(event) => {
              setUploadError(null);
              setUploadedTitle(null);
              setFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>
        <label className="block text-sm text-slate-300" htmlFor="audio-title">
          제목 (비워두면 파일 이름을 씁니다)
          <input
            id="audio-title"
            data-testid="audio-title-input"
            className={fieldClassName}
            value={title}
            disabled={uploadPending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block text-sm text-slate-300" htmlFor="audio-artist">
          만든 사람 · 출처 (선택)
          <input
            id="audio-artist"
            data-testid="audio-artist-input"
            className={fieldClassName}
            placeholder="예: Kevin MacLeod (incompetech.com)"
            value={artist}
            disabled={uploadPending}
            onChange={(event) => setArtist(event.target.value)}
          />
        </label>
        <label className="block text-sm text-slate-300" htmlFor="audio-license">
          이 음원을 어떻게 구하셨나요?
          <select
            id="audio-license"
            data-testid="audio-license-select"
            className={fieldClassName}
            value={licenseKind}
            disabled={uploadPending}
            onChange={(event) => {
              const next = event.target.value as LicenseKind | "";
              setLicenseKind(next);
              const option = LICENSE_OPTIONS.find((candidate) => candidate.value === next);
              // Every kind but "other" has a fixed answer, so it is filled in rather than asked twice.
              if (option && option.attribution !== "ask") setAttributionRequired(option.attribution);
            }}
          >
            <option value="">고르지 않음</option>
            {LICENSE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {selectedLicense?.attribution === "ask" && (
          <label className="flex items-center gap-2 text-sm text-slate-300" htmlFor="audio-attribution-required">
            <input
              id="audio-attribution-required"
              data-testid="audio-attribution-required"
              type="checkbox"
              checked={attributionRequired}
              disabled={uploadPending}
              onChange={(event) => setAttributionRequired(event.target.checked)}
            />
            출처를 표시해야 하는 음원입니다
          </label>
        )}
        {attributionRequired && (
          <label className="block text-sm text-slate-300" htmlFor="audio-attribution-text">
            캡션에 적을 문구
            <input
              id="audio-attribution-text"
              data-testid="audio-attribution-text"
              className={fieldClassName}
              placeholder="예: Music: 「Night Archive」 by ○○○ (CC BY 4.0)"
              value={attributionText}
              disabled={uploadPending}
              onChange={(event) => setAttributionText(event.target.value)}
            />
          </label>
        )}
        <label className="block text-sm text-slate-300" htmlFor="audio-source-url">
          받은 곳 주소 (선택)
          <input
            id="audio-source-url"
            data-testid="audio-source-url"
            className={fieldClassName}
            placeholder="나중에 출처를 다시 확인할 수 있게 적어두면 좋습니다"
            value={sourceUrl}
            disabled={uploadPending}
            onChange={(event) => setSourceUrl(event.target.value)}
          />
        </label>
        <button
          type="button"
          data-testid="audio-upload-button"
          className={primaryButton}
          disabled={!file || !licenseKind || uploadPending}
          onClick={() => void upload()}
        >
          {uploadPending ? "올리는 중..." : "보관함에 추가"}
        </button>
        {file && !licenseKind && (
          <p data-testid="audio-license-required" className="text-xs text-amber-300">
            음원을 어떻게 구하셨는지 골라야 올릴 수 있습니다. 지금이 출처를 아는 유일한 시점입니다.
          </p>
        )}
        {uploadError && (
          <p role="alert" data-testid="audio-upload-error" data-error-code={uploadError.code} className="text-sm text-rose-400">
            {uploadError.message}
          </p>
        )}
        {uploadedTitle && (
          <p data-testid="audio-upload-success" className="text-sm text-emerald-400">
            「{uploadedTitle}」을(를) 보관함에 추가했습니다.
          </p>
        )}
      </div>

      {state.status === "loading" && <Spinner label="음원을 불러오는 중..." />}
      {state.status === "error" && (
        <div className="space-y-2">
          <p role="alert" data-testid="audio-library-error" data-error-code={state.error.code} className="text-sm text-rose-400">
            {state.error.message}
          </p>
          <button type="button" className={outlineButton} onClick={load}>
            다시 시도
          </button>
        </div>
      )}

      {state.status === "ready" && !tracks.length && (
        <p data-testid="audio-library-empty" className="text-sm text-slate-400">
          아직 올린 음원이 없습니다. 위에서 파일을 추가하면 병합 화면에서 고를 수 있습니다.
        </p>
      )}

      {state.status === "ready" && Boolean(tracks.length) && (
        <ul className="space-y-3" data-testid="audio-tracks">
          {tracks.map((track) => (
            <li key={track.trackId} data-testid={`audio-track-${track.trackId}`} className={cardSection}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-slate-100">{track.title}</span>
                <span className="text-xs text-slate-400 tabular-nums">
                  {trackDuration(track.durationSeconds)} · {fileSize(track.bytes)}
                </span>
              </div>
              {track.artist && <p className="text-xs text-slate-400">{track.artist}</p>}
              {/* Only shown when the track actually carries the flag — a caution on every row would be ignored. */}
              {track.attributionRequired && (
                <p data-testid={`audio-track-attribution-${track.trackId}`} className="text-xs text-amber-300">
                  이 음원은 캡션에 출처를 적어야 합니다.
                </p>
              )}
              {track.attributionText && (
                <p data-testid={`audio-track-attribution-text-${track.trackId}`} className="text-xs text-slate-400">
                  캡션 문구: {track.attributionText}
                </p>
              )}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- music has no spoken content to caption */}
              <audio
                data-testid={`audio-track-player-${track.trackId}`}
                className="w-full"
                controls
                preload="none"
                src={audioTrackContentUrl(track.trackId)}
              />
              {/* Deleting is offered here (unlike the video archive) because the original file is still on the
                  uploader's own machine — a wrong upload costs one re-drag to undo, not a paid regeneration.
                  It still asks first, since the copy in the app is the one projects point at. */}
              {deleteConfirm === track.trackId ? (
                <div
                  role="alertdialog"
                  aria-label={`${track.title} 삭제 확인`}
                  data-testid={`audio-track-delete-confirm-${track.trackId}`}
                  className="space-y-2 rounded-lg border border-rose-400/40 bg-slate-900/70 p-3"
                >
                  <p className="text-sm font-semibold text-rose-300">이 음원을 보관함에서 지울까요?</p>
                  <p className="text-xs text-slate-300">보관함에서만 사라집니다. 원본 파일은 컴퓨터에 그대로 있습니다.</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={outlineButton}
                      disabled={deletePending === track.trackId}
                      onClick={() => setDeleteConfirm(null)}
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      data-testid={`audio-track-delete-confirm-button-${track.trackId}`}
                      className="rounded-full border border-rose-400/30 px-3 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                      disabled={deletePending === track.trackId}
                      onClick={() => void removeTrack(track.trackId)}
                    >
                      {deletePending === track.trackId ? "지우는 중..." : "네, 지웁니다"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid={`audio-track-delete-${track.trackId}`}
                  className="self-start rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400 hover:bg-white/5 disabled:opacity-50"
                  disabled={Boolean(deletePending)}
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteConfirm(track.trackId);
                  }}
                >
                  지우기
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleteError && (
        <p role="alert" data-testid="audio-delete-error" data-error-code={deleteError.code} className="text-sm text-rose-400">
          {deleteError.message}
        </p>
      )}
    </section>
  );
}
