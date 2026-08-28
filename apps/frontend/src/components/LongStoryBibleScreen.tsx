import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Asset, LongStoryBible, LongStoryBibleAssetLink, LongStoryBibleCollection, LongStoryBibleItem, LongStoryBibleItemInput, LongStoryBibleRelationshipIssue } from "@ai-animation-studio/shared";

import { createLongStoryBibleItem, deleteLongStoryBibleItem, getLongProjectStoryBible, getLongStoryBibleRelationshipAudit, toLongStoryBibleDisplayError, updateLongStoryBibleContent, updateLongStoryBibleItem } from "../api/longStoryBibleApi.js";
import { listAssets, toAssetDisplayError } from "../api/assetsApi.js";
import { getLongProject, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";

interface Props { projectId: string; onBack: () => void; }
type DisplayError = { code: string; message: string };
const TABS: Array<{ value: LongStoryBibleCollection; label: string }> = [
  // These labels must stay word-for-word the ones the Asset Library uses for its folder types, because a tab
  // here only accepts folders of the matching type and the server speaks one vocabulary for both
  // (usageRole: character | background | object | style). They did not match — this tab said 장소 while the
  // library said 배경, and the library said 오브젝트 while this one said 소품 — so choosing a folder meant
  // knowing a translation table nothing on screen showed you. 장소 became 배경 (the server's word); 오브젝트
  // became 소품 in the library instead (the natural Korean for a prop, and its own prose already said 소품).
  { value: "characters", label: "캐릭터" }, { value: "locations", label: "배경" }, { value: "props", label: "소품" },
  { value: "secrets", label: "비밀" }, { value: "foreshadowing", label: "복선" },
];
const ASSET_LINK_COLLECTIONS: readonly LongStoryBibleCollection[] = ["characters", "locations", "props"];
/**
 * The two collections whose text is what actually reaches the model, and the only ones with a reveal Episode.
 *
 * A character's description is not sent anywhere — its linked picture is what the image step uses — which is
 * why that field was removed from the other three. A secret is the opposite: the words ARE the item, and when
 * they may be used is what keeps Episode 8's twist out of Episode 3.
 */
const REVEAL_COLLECTIONS: readonly LongStoryBibleCollection[] = ["secrets", "foreshadowing"];

const compactField =
  "rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const fieldClassName = `mt-1.5 w-full ${compactField}`;

/**
 * `basic` and `world` are free-form string maps, and this screen used to hand them to the user as two raw JSON
 * textareas — brackets, quotes and commas to get right, with "JSON 객체 형식이어야 합니다" as the only feedback.
 * A person writing a character's world cannot author that. These two helpers translate between the stored JSON
 * text and a plain 항목 이름 / 내용 table, so the same data can be edited without typing punctuation.
 *
 * `rowsFrom` returns null when the object holds anything but strings (nested objects, arrays, numbers). That
 * data is real and must not be flattened away, so those drafts keep the JSON editor as their only surface —
 * never silently rewritten into a shape the table can express.
 */
type BibleRow = { key: string; value: string };

function rowsFrom(draft: string): BibleRow[] | null {
  try {
    const parsed: unknown = JSON.parse(draft);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.some(([, value]) => typeof value !== "string")) return null;
    return entries.map(([key, value]) => ({ key, value: value as string }));
  } catch { return null; }
}

/**
 * Empty names are dropped on the way out — they are not valid keys.
 *
 * That is why the rows cannot be derived from this string, and why `rows` is state. Deriving them is what the
 * screen used to do, and it made "항목 추가" do nothing at all: the new row has an empty name, this function
 * dropped it, the JSON came back unchanged, and re-deriving produced the same rows as before. The button
 * appeared to be broken because, visibly, it was.
 */
function draftFromRows(rows: BibleRow[]): string {
  const record: Record<string, string> = {};
  for (const row of rows) if (row.key.trim()) record[row.key.trim()] = row.value;
  return JSON.stringify(record, null, 2);
}

function PlainRecordEditor({ heading, hint, rows, disabled, onChange, testId }: {
  heading: string; hint: string; rows: BibleRow[] | null; disabled: boolean;
  onChange: (rows: BibleRow[]) => void; testId: string;
}) {
  if (rows === null) {
    return (
      <div data-testid={`${testId}-unsupported`} className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-400">
        <p className="font-medium text-slate-300">{heading}</p>
        <p className="mt-1">이 항목에는 표로 보여줄 수 없는 형태의 내용이 들어 있습니다. 아래 "고급 편집"에서 확인해 주세요.</p>
      </div>
    );
  }
  // An empty editor used to show a sentence and a button, and nothing to type into. A person who opened this
  // screen to write down their world saw no field at all and read the whole section as not working — which is
  // exactly how it was reported. One blank line costs nothing (a row with no name is dropped on save, see
  // draftFromRows) and means the first thing anyone can do here is start typing.
  const shown = rows.length === 0 ? [{ key: "", value: "" }] : rows;
  return (
    <div data-testid={testId} className="space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-3">
      <p className="text-sm font-medium text-slate-300">{heading}</p>
      <p className="text-xs text-slate-500">{hint}</p>
      {shown.map((row, index) => (
        <div key={index} className="flex flex-wrap items-start gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            무엇에 대한 설명인지
            {/* The accessible name matches the visible one. Sharing "항목 이름" with the item-name field below put
                two different controls under one name — ambiguous to a screen reader, and to a query. */}
            <input
              aria-label="무엇에 대한 설명인지"
              className={fieldClassName}
              value={row.key}
              disabled={disabled}
              onChange={(event) => onChange(shown.map((item, position) => position === index ? { ...item, key: event.target.value } : item))}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-slate-400">
            내용
            <input
              className={fieldClassName}
              value={row.value}
              disabled={disabled}
              onChange={(event) => onChange(shown.map((item, position) => position === index ? { ...item, value: event.target.value } : item))}
            />
          </label>
          <button
            type="button"
            className="mt-5 rounded-full border border-rose-400/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
            disabled={disabled}
            onClick={() => onChange(shown.filter((_, position) => position !== index))}
          >
            지우기
          </button>
        </div>
      ))}
      {/* Named after its own section: this screen already has an "항목 추가" button for the collection form
          below, and a second and third one with the same accessible name leaves both a screen reader and a
          person scanning the page unable to tell which list a button appends to. */}
      <button
        type="button"
        className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
        disabled={disabled}
        onClick={() => onChange([...shown, { key: "", value: "" }])}
      >
        {heading}에 항목 추가
      </button>
    </div>
  );
}

const jsonFieldClassName =
  "mt-1.5 min-h-28 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const dangerButton =
  "rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(225,29,72,0.3)] disabled:opacity-50";
const smallOutlineButton =
  "rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallRemoveButton =
  "rounded-full border border-rose-400/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50";
const cardSection = "space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2.5 text-base font-semibold">
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
      />
      {children}
    </h3>
  );
}

function itemInput(item: LongStoryBibleItem): LongStoryBibleItemInput {
  const { id: _id, ...input } = item;
  return input;
}

export function LongStoryBibleScreen({ projectId, onBack }: Props) {
  const [bible, setBible] = useState<LongStoryBible | null>(null);
  const [collection, setCollection] = useState<LongStoryBibleCollection>("characters");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);
  const [name, setName] = useState("");
  const [itemId, setItemId] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  /**
   * Whether the person has typed in the name field themselves.
   *
   * Without it, filling the name in from the chosen folder would overwrite a name they had already corrected
   * the moment they changed folders — the screen undoing an edit, silently. Once touched, the field is theirs.
   */
  const [nameTouched, setNameTouched] = useState(false);
  /**
   * From which Episode this secret or foreshadowing may be used — the field the whole mechanism turns on.
   *
   * Script generation splits the Story Bible's secrets by comparing this to the Episode being written: at or
   * below it the secret is handed over as "you may use this", above it as "you must not". A secret without a
   * value defaults to 1 there, meaning available from the first Episode — so with no way to set it, every
   * secret was always revealable and the split did nothing. The field was in the stored shape and the server
   * accepted it; only the screen never asked for it.
   */
  const [revealFrom, setRevealFrom] = useState("");
  /**
   * A failed save, shown inside the form rather than only at the top of the screen.
   *
   * The screen-level error sits above everything; this form is the last thing on a long page. A person who
   * pressed 항목 추가 is looking at the button, and the refusal was rendering several screens above them — so
   * the app appeared to do nothing at all. An error nobody can see is the same as no error, and worse than a
   * visible one, because the next thing a person does is press again.
   */
  const [submitError, setSubmitError] = useState<DisplayError | null>(null);
  const [editing, setEditing] = useState<LongStoryBibleItem | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LongStoryBibleItem | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetLoading, setAssetLoading] = useState(true);
  const [episodeCount, setEpisodeCount] = useState<number | null>(null);
  const [assetId, setAssetId] = useState("");
  const [versionPolicy, setVersionPolicy] = useState<LongStoryBibleAssetLink["versionPolicy"]>("pinned_version");
  const [scopeMode, setScopeMode] = useState<"all" | "episode">("all");
  const [scopeEpisode, setScopeEpisode] = useState("1");
  const [relationshipAudit, setRelationshipAudit] = useState<LongStoryBibleRelationshipIssue[] | null>(null);
  const [relationshipAuditLoading, setRelationshipAuditLoading] = useState(false);
  const [relationshipAuditError, setRelationshipAuditError] = useState<DisplayError | null>(null);
  const [basicDraft, setBasicDraft] = useState("{}");
  const [worldDraft, setWorldDraft] = useState("{}");
  /**
   * The rows the person is editing, held as state rather than derived from worldDraft on every render.
   *
   * Derived was the bug: a new row starts with an empty name, draftFromRows drops empty names because they are
   * not valid keys, so the JSON came back identical and re-deriving produced the row list from before. Pressing
   * "항목 추가" did nothing, and typing into a row before naming it lost the text. Rows are the thing being
   * edited; the JSON is what they serialize to, and it only flows the other way when the stored value is
   * (re)loaded or edited directly under 고급 편집.
   */
  const [worldRows, setWorldRows] = useState<BibleRow[] | null>(null);
  const [contentValidationError, setContentValidationError] = useState<string | null>(null);
  const busy = useRef(false);
  const loadVersion = useRef(0);

  async function load() {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const [bibleResult, assetsResult, projectResult] = await Promise.allSettled([
        getLongProjectStoryBible(projectId), listAssets(), getLongProject(projectId),
      ]);
      if (version !== loadVersion.current) return;
      if (bibleResult.status === "fulfilled") {
        setBible(bibleResult.value.storyBible); setError(null);
        setBasicDraft(JSON.stringify(bibleResult.value.storyBible.basic, null, 2));
        setWorldDraft(JSON.stringify(bibleResult.value.storyBible.world, null, 2));
        setWorldRows(rowsFrom(JSON.stringify(bibleResult.value.storyBible.world, null, 2)));
      }
      else setError(toLongStoryBibleDisplayError(bibleResult.reason));
      if (assetsResult.status === "fulfilled") {
        /* Folders are now the linkable unit, so two things changed here.
           `!asset.isFolder` is gone — it excluded exactly the thing a 등장인물 entry should point at.
           `approved` is asked of images only: a Folder has no file to approve and the backend cannot set the
           flag on one (`assets.repository.ts` creates Folders with `approved: false` and its update
           whitelist covers displayName/description/tags), so requiring it would hide every Folder forever.
           Child images stay out — they belong to a Folder and are reached through it. */
        setAssets(assetsResult.value.assets.filter((asset) =>
          asset.enabled && !asset.parentFolderId && (asset.isFolder || asset.approved)));
      } else setError(toAssetDisplayError(assetsResult.reason));
      setAssetLoading(false);
      if (projectResult.status === "fulfilled") setEpisodeCount(projectResult.value.project.episodeCount);
      else setError(toLongProjectDisplayError(projectResult.reason));
    } catch (caught) {
      if (version === loadVersion.current) setError(toLongStoryBibleDisplayError(caught));
    } finally { if (version === loadVersion.current) setLoading(false); }
  }
  useEffect(() => { void load(); }, [projectId]);

  async function loadRelationshipAudit(): Promise<void> {
    if (relationshipAuditLoading) return;
    setRelationshipAuditLoading(true); setRelationshipAuditError(null);
    try { setRelationshipAudit((await getLongStoryBibleRelationshipAudit(projectId)).issues); }
    catch (caught) { setRelationshipAuditError(toLongStoryBibleDisplayError(caught)); }
    finally { setRelationshipAuditLoading(false); }
  }

  function parseContentDraft(value: string, label: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, unknown>;
    } catch { setContentValidationError(`${label}은(는) JSON 객체 형식이어야 합니다.`); return null; }
  }
  async function saveContent(): Promise<void> {
    if (busy.current) return;
    const basic = parseContentDraft(basicDraft, "기본 설정");
    const world = parseContentDraft(worldDraft, "세계관 설정");
    if (!basic || !world) return;
    setContentValidationError(null); busy.current = true; setPending(true);
    try {
      const response = await updateLongStoryBibleContent(projectId, { basic, world });
      setBible(response.storyBible); setBasicDraft(JSON.stringify(response.storyBible.basic, null, 2)); setWorldDraft(JSON.stringify(response.storyBible.world, null, 2)); setWorldRows(rowsFrom(JSON.stringify(response.storyBible.world, null, 2))); setError(null);
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }

  function resetEditor(): void {
    setName(""); setItemId(""); setDescription(""); setStatus(""); setEditing(null); setValidationError(null); setNameTouched(false); setRevealFrom("");
    setAssetId(""); setVersionPolicy("pinned_version"); setScopeMode("all"); setScopeEpisode("1");
  }
  function startEdit(item: LongStoryBibleItem): void {
    setEditing(item); setName(item.name ?? ""); setItemId(item.id); setDescription(item.description ?? ""); setStatus(item.status ?? ""); setValidationError(null); setDeleteTarget(null); setNameTouched(true); setRevealFrom(item.revealAvailableEpisode === undefined ? "" : String(item.revealAvailableEpisode));
    setAssetId(item.assetLink?.assetId ?? ""); setVersionPolicy(item.assetLink?.versionPolicy ?? "pinned_version");
    setScopeMode(item.assetLink?.episodeScope.mode ?? "all"); setScopeEpisode(item.assetLink?.episodeScope.mode === "episode" ? String(item.assetLink.episodeScope.episode) : "1");
  }
  function selectedAsset(): Asset | undefined { return assets.find((asset) => asset.assetId === assetId); }
  function assetLinkDraft(): LongStoryBibleAssetLink | undefined {
    if (!assetId) return undefined;
    const asset = selectedAsset();
    if (!asset) return editing?.assetLink?.assetId === assetId ? editing.assetLink : undefined;
    const episode = Number(scopeEpisode);
    return {
      assetId, versionPolicy, pinnedVersion: versionPolicy === "pinned_version" ? asset.version : null,
      episodeScope: scopeMode === "episode" && Number.isInteger(episode) && episode >= 1 ? { mode: "episode", episode } : { mode: "all" },
    };
  }
  function draft(): LongStoryBibleItemInput {
    const link = assetLinkDraft();
    return {
      ...(itemId.trim() ? { id: itemId.trim() } : {}), name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}), ...(status.trim() ? { status: status.trim() } : {}),
      ...(REVEAL_COLLECTIONS.includes(collection) && Number.isInteger(Number(revealFrom)) && Number(revealFrom) >= 1
        ? { revealAvailableEpisode: Number(revealFrom) }
        : {}),
      ...(ASSET_LINK_COLLECTIONS.includes(collection) && link ? { assetLink: link } : {}),
      ...(ASSET_LINK_COLLECTIONS.includes(collection) && editing && !assetId ? { assetLink: null } : {}),
    };
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (!name.trim()) { setValidationError("이름을 입력하세요."); return; }
    setValidationError(null); setSubmitError(null); busy.current = true; setPending(true);
    try {
      if (editing) {
        const response = await updateLongStoryBibleItem(projectId, collection, editing.id, { item: { ...itemInput(editing), ...draft() } });
        setBible(response.storyBible);
      } else {
        const response = await createLongStoryBibleItem(projectId, collection, { item: draft() });
        setBible(response.storyBible);
      }
      setError(null); setSubmitError(null); resetEditor();
    } catch (caught) { setSubmitError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }
  async function confirmDelete() {
    if (!deleteTarget || busy.current) return;
    busy.current = true; setPending(true);
    try {
      const response = await deleteLongStoryBibleItem(projectId, collection, deleteTarget.id);
      setBible(response.storyBible); setError(null); setDeleteTarget(null);
      if (editing?.id === deleteTarget.id) resetEditor();
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }
  const items = bible?.[collection] ?? [];
  const collectionLabel = TABS.find((tab) => tab.value === collection)?.label ?? collection;
  const supportsAssetLink = ASSET_LINK_COLLECTIONS.includes(collection);
  /**
   * 등장인물 links to a Folder and nothing else — the same rule the short project's 등장 캐릭터 list follows.
   * A single drawing is one pose of a character, not the character, and the per-child description block the
   * image prompt builds has nothing to read unless the link points at a Folder.
   * 배경·소품 accept either: a Folder when several angles of one place exist, a single image when it is just
   * the one picture.
   */
  const linkableAssets = collection === "characters"
    ? assets.filter((asset) => asset.isFolder && asset.assetType === "character")
    : assets;

  return (
    <section className="mt-8 max-w-3xl space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>
        프로젝트로 돌아가기
      </button>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        등장인물·설정집
      </h2>
      {/* Was "Story Bible" — an English term with no on-screen explanation, sitting next to a screen called
          스토리 개요. Renamed, and the difference stated as the question each store answers rather than left
          for the user to infer. */}
      <p className="text-sm text-slate-400">
        등장인물·배경·소품·비밀이 <strong className="text-slate-200">무엇인지</strong> 적는 곳입니다 — 시간 순서와 무관한 설정집이에요.
        "몇 화에 무슨 일이 일어나는가"는 여기가 아니라 <strong className="text-slate-200">스토리 개요</strong>에 적습니다.
      </p>
      {/* The sentence removed here read: "여기 적은 내용은 회차마다 등장인물의 생김새·성격이 흔들리지 않게
          붙잡아 주는 역할을 합니다." It was not true of either half.

          Personality/description: buildContext (episode-scripts.service.ts) hands the script prompt
          storyBible.basic, storyBible.world, secrets and foreshadowing — and not characters, locations or props.
          episode-context-builder.ts's own field comment says those arrays are "always empty today".

          Appearance: reference images reach generation only through confirmed Asset mappings, which is a
          separate screen and a separate step, not this one.

          So 비밀·복선 really do reach the AI and the other three tabs currently do not. Wiring them up is real
          work and is queued; until it lands, the screen says what it can honestly say. A screen that promises
          an effect it does not have is worse than one that promises less — the user cannot tell the difference
          by looking, and spends effort here expecting an outcome that never arrives. */}
      <p className="text-sm text-slate-400">
        지금은 <strong className="text-slate-200">비밀·복선</strong>에 적은 내용이 대본 생성에 함께 전달됩니다.
        캐릭터·배경·소품은 <strong className="text-slate-200">참고 이미지 연결</strong> 단계에서 이미지를 붙였을 때
        그 이미지가 생성에 쓰입니다 — 여기 적은 설명글 자체가 전달되지는 않습니다.
      </p>
      {error && (
        <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}

      <section aria-label="기본·세계관 설정" className={cardSection}>
        <SectionHeading>기본·세계관 설정</SectionHeading>
        <p className="text-sm text-slate-400">작품 전체에 걸쳐 변하지 않는 설정을 적습니다. 저장해도 대본·이미지·영상은 만들어지지 않습니다.</p>
        {/* When this is read is the whole story, and the screen never said it. Everything here goes into the
            prompt at two moments — 회차 나누기, and each Episode's script generation — so anything written after
            an Episode's script exists does not reach that Episode. Without this line the section reads as
            something you fill in whenever, and a secret written too late quietly does nothing. */}
        <p data-testid="story-bible-timing" className="rounded-xl border border-violet-400/25 bg-violet-500/[0.06] p-3 text-sm text-slate-300">
          여기 적은 내용은 <strong className="text-slate-100">회차 나누기</strong>와 <strong className="text-slate-100">각 회차 대본 생성</strong> 때 AI에게 전달됩니다.
          그래서 <strong className="text-slate-100">대본을 만들기 전에</strong> 적어야 합니다 — 이미 대본이 있는 회차에는 안 들어가고,
          아직 만들지 않은 회차부터 반영됩니다. 이미 만든 회차에 넣으려면 그 회차 대본을 다시 만들어야 합니다.
        </p>
        {contentValidationError && (
          <p role="alert" data-testid="story-bible-content-validation-error" className="text-sm text-rose-400">
            {contentValidationError}
          </p>
        )}
        {/* 작품 기본 정보 was a second editor for fields that already have one.
            The server copies title/logline/overview/genre/tone/theme/ending_direction/audience out of the
            project's own settings when a Long Project is created, and this table showed that copy — raw English
            keys and all — as if it were something to fill in. Editing the real settings afterwards does not
            update the copy, so the two drift apart and BOTH reach the script prompt, disagreeing. There is
            nothing here a person can do that 작품 기본 설정 does not do better, and one thing they could do that
            is purely destructive: delete the title.
            The stored `basic` object is not removed from the frontend — that is the server's data and clearing
            it here would silently drop whatever an older project has in it. It stays reachable under 고급 편집
            below, and removing it from the prompt is CLI's side. */}
        <PlainRecordEditor
          testId="story-bible-world-rows"
          heading="세계관 설명"
          hint='왼쪽은 무엇에 대한 설명인지, 오른쪽은 그 내용입니다 — AI가 왼쪽을 이름표로 읽습니다. 예: 시대 → 20년 뒤 미래 / 지역 → 바다 위 도시'
          rows={worldRows}
          disabled={pending}
          onChange={(rows) => { setWorldRows(rows); setWorldDraft(draftFromRows(rows)); setContentValidationError(null); }}
        />
        {/* The raw text stays reachable — it is still the stored form, and the table cannot express nested
            data. Folded, so it is available without being the thing a person is first asked to type into. */}
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-400 hover:text-slate-300">고급 편집 (직접 수정)</summary>
          <div className="mt-2 space-y-3">
            <label className="block text-sm text-slate-300">
              기본 설정 JSON
              <textarea
                aria-label="기본 설정 JSON"
                value={basicDraft}
                disabled={pending}
                onChange={(event) => { setBasicDraft(event.target.value); setContentValidationError(null); }}
                className={jsonFieldClassName}
              />
            </label>
            <label className="block text-sm text-slate-300">
              세계관 설정 JSON
              <textarea
                aria-label="세계관 설정 JSON"
                value={worldDraft}
                disabled={pending}
                // Editing the stored form directly is the one place rows follow the JSON rather than lead it.
                onChange={(event) => { setWorldDraft(event.target.value); setWorldRows(rowsFrom(event.target.value)); setContentValidationError(null); }}
                className={jsonFieldClassName}
              />
            </label>
          </div>
        </details>
        <button type="button" className={outlineButton} onClick={() => void saveContent()} disabled={pending}>
          {pending ? "저장하는 중..." : "기본·세계관 설정 저장"}
        </button>
      </section>

      {/* 전체 비주얼 스타일 moved to 작품 기본 설정 (GlobalStyleAssetCard).
          Nothing about it is per-character or per-Episode — the server attaches it to every Episode's image
          work — so it belongs with the other project-wide choices, beside 화면 비율, not as a ninth thing to
          fill in on a screen that is about characters and world detail. It is still stored inside the Story
          Bible's `basic` record; that is storage, not a reason for the control to live here. */}

      <section aria-label="설정집 연결 상태 점검" className={cardSection}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionHeading>연결 상태 점검</SectionHeading>
            <p className="text-sm text-slate-400">설정집에서 빠진 연결이 없는지 조회만 하는 점검입니다.</p>
          </div>
          <button type="button" className={outlineButton} onClick={() => void loadRelationshipAudit()} disabled={relationshipAuditLoading}>
            {relationshipAuditLoading ? "확인하는 중..." : relationshipAudit === null ? "연결 상태 확인" : "다시 확인"}
          </button>
        </div>
        {relationshipAuditLoading && <p className="text-sm text-slate-400">설정집 연결 상태를 확인하는 중...</p>}
        {relationshipAuditError && (
          <div className="space-y-2">
            <p role="alert" data-error-code={relationshipAuditError.code} className="text-sm text-rose-400">
              {relationshipAuditError.message}
            </p>
            <button type="button" className={smallOutlineButton} onClick={() => void loadRelationshipAudit()} disabled={relationshipAuditLoading}>
              다시 시도
            </button>
          </div>
        )}
        {relationshipAudit && relationshipAudit.length === 0 && (
          <p data-testid="relationship-audit-healthy" className="text-sm text-emerald-300">
            설정집 연결 상태에 문제가 없습니다.
          </p>
        )}
        {relationshipAudit && relationshipAudit.length > 0 && (
          <ul aria-label="연결 상태 문제 목록" className="space-y-2">
            {relationshipAudit.map((issue, index) => (
              <li
                key={`${issue.collection}-${issue.itemId}-${issue.field}-${index}`}
                className="rounded-lg border border-amber-400/30 bg-amber-500/5 p-2.5 text-sm text-slate-200"
              >
                <strong>{issue.collection}</strong> / {issue.itemId} / {issue.field}: {issue.missingIds.join(", ")} 항목이 빠져 있습니다
              </li>
            ))}
          </ul>
        )}
      </section>

      <div role="tablist" aria-label="설정집 항목 종류" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={collection === tab.value}
            onClick={() => { setCollection(tab.value); resetEditor(); setDeleteTarget(null); }}
            className={
              collection === tab.value
                ? "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3.5 py-1.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)]"
                : "rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-slate-300 hover:bg-white/5"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* The per-collection search box and its 복제 button are gone.
          It only ever searched the items already listed a few lines below it, and its one action was to
          duplicate one. Duplication existed as a workaround from when an item could be scoped to a single
          Episode: the only way to put one character in Episodes 1, 3 and 7 was to make three copies. Episodes
          now pick their own references directly, so the workaround has no job — and using it is actively
          harmful, because automatic matching keys on the name and two items with the same name both match. */}
      {loading && !bible && <Spinner label="설정집을 불러오는 중..." />}
      {bible && items.length === 0 && (
        <p data-testid="story-bible-empty" className="text-sm text-slate-400">
          아직 등록된 {collectionLabel} 항목이 없습니다.
        </p>
      )}
      {bible && items.length > 0 && (
        <ul aria-label={`${collectionLabel} 목록`} className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border border-white/10 bg-slate-900/70 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-slate-100">{item.name || item.id}</strong>
                <span className="text-xs text-slate-400">{item.id}</span>
                {item.status && <span className="text-xs text-violet-300">{item.status}</span>}
              </div>
              {item.description && <p className="mt-1 text-sm text-slate-300">{item.description}</p>}
              {item.assetLink && (
                <p data-testid={`asset-link-${item.id}`} className="mt-1 text-sm text-emerald-300">
                  Asset: {item.assetLink.assetId} · {item.assetLink.versionPolicy === "pinned_version" ? `v${item.assetLink.pinnedVersion} 고정` : "최신 버전 따라가기"} ·{" "}
                  {item.assetLink.episodeScope.mode === "all" ? "모든 에피소드" : `에피소드 ${item.assetLink.episodeScope.episode}`}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button type="button" className={smallOutlineButton} onClick={() => startEdit(item)}>
                  수정
                </button>
                <button type="button" className={smallRemoveButton} onClick={() => setDeleteTarget(item)} disabled={pending}>
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        aria-label={editing ? "설정집 항목 수정" : "설정집 항목 추가"}
        onSubmit={(event) => void submit(event)}
        className="space-y-3 rounded-2xl border border-violet-400/30 bg-slate-900/70 p-5"
      >
        <SectionHeading>{editing ? "항목 수정" : "항목 추가"}</SectionHeading>
        {validationError && (
          <p role="alert" data-testid="story-bible-validation-error" className="text-sm text-rose-400">
            {validationError}
          </p>
        )}
        {/* ID, 설명, 상태 are gone, and 이름 fills itself in from the chosen folder.
            Everything asked for here already exists on the Asset the person is about to pick: the folder has a
            name and a description, and they typed both when they made it. Asking again produced two names for
            one character — and because automatic matching keys on the name, the one typed here silently decided
            whether the reference was ever found, while the folder's own name sat unused a few pixels away.
            ID was generated when left blank, which is every time; 설명 reached nothing at all (the script
            prompt never receives these items); 상태 was free text nothing reads.
            이름 stays visible and editable, because it IS what matching keys on — a folder called
            "이베드_최종_v3" needs fixing before it will ever match a script — but it is filled in for you. */}
        {supportsAssetLink && assetId && (
          <p data-testid="story-bible-name-from-folder" className="text-xs text-slate-400">
            이름은 고른 폴더에서 가져왔습니다. 대본 속 이름과 다르면 여기서 고쳐 주세요 — 이 이름으로 장면을 찾습니다.
          </p>
        )}
        <label className="block text-sm text-slate-300">
          이름
          <input
            aria-label="항목 이름"
            value={name}
            disabled={pending}
            onChange={(event) => { setName(event.target.value); setNameTouched(true); setValidationError(null); }}
            className={fieldClassName}
          />
        </label>
        {/* Only for 비밀·복선 — the two collections whose text is actually sent. For the other three the
            description was a second copy of what the linked folder already carries, which is why it is gone
            from those; here it is the item itself. */}
        {REVEAL_COLLECTIONS.includes(collection) && (
          <>
            <label className="block text-sm text-slate-300">
              내용
              <textarea
                aria-label="항목 내용"
                data-testid="story-bible-item-content"
                rows={3}
                value={description}
                disabled={pending}
                onChange={(event) => setDescription(event.target.value)}
                className={fieldClassName}
              />
              <span className="mt-1 block text-xs text-slate-500">여기 적은 글이 대본을 쓸 때 그대로 전달됩니다.</span>
            </label>
            <label className="block text-sm text-slate-300">
              몇 화부터 써도 되나
              <input
                aria-label="공개 가능 회차"
                data-testid="story-bible-reveal-from"
                type="number"
                min={1}
                placeholder="1"
                value={revealFrom}
                disabled={pending}
                onChange={(event) => setRevealFrom(event.target.value)}
                className={fieldClassName}
              />
              {/* The default is stated, because leaving it blank is a real choice with a real effect and an
                  empty box that silently means "from the first Episode" is how a twist gets spoiled. */}
              <span className="mt-1 block text-xs text-slate-500">
                이 회차 전까지는 <strong className="text-slate-400">쓰지 말라고</strong> 대본 AI에게 전달됩니다. 비워 두면 1화부터 쓸 수 있습니다.
              </span>
            </label>
          </>
        )}
        {supportsAssetLink && (
          <fieldset className="space-y-3 rounded-xl border border-white/10 bg-slate-950/30 p-3.5 disabled:opacity-50" disabled={pending || assetLoading}>
            <legend className="px-1 text-sm text-slate-300">이미지 보관함에서 연결(선택 사항)</legend>
            {assetLoading && <p className="text-sm text-slate-400">사용 가능한 에셋을 불러오는 중...</p>}
            {!assetLoading && linkableAssets.length === 0 && (
              <p className="text-sm text-slate-400">
                {collection === "characters"
                  ? "이미지 보관함에 캐릭터 폴더가 없습니다. 보관함에서 캐릭터 폴더를 먼저 만들고 그 안에 이미지를 넣어 주세요."
                  : "쓸 수 있는 이미지 보관함 항목이 없습니다."}
              </p>
            )}
            {collection === "characters" && (
              <p className="text-xs text-slate-400">
                캐릭터 <strong className="text-slate-300">폴더</strong>만 고를 수 있습니다 — 낱장 이미지 하나는 캐릭터가 아니라
                그 캐릭터의 한 모습이라서요. 폴더를 고르면 그 안의 정면·옆모습·뒷모습이 함께 전달됩니다.
              </p>
            )}
            <label className="block text-sm text-slate-300">
              {collection === "characters" ? "캐릭터 폴더" : "에셋"}
              <select
                aria-label="연결할 에셋"
                value={assetId}
                onChange={(event) => {
                  const nextAssetId = event.target.value;
                  setAssetId(nextAssetId);
                  // The folder already carries both, and asking for them again is what produced two names for
                  // one character. A name the person has typed themselves is never overwritten.
                  const picked = assets.find((asset) => asset.assetId === nextAssetId);
                  if (picked) {
                    if (!nameTouched) setName(picked.displayName);
                    setDescription(picked.description ?? "");
                    setValidationError(null);
                  }
                }}
                className={fieldClassName}
              >
                <option value="">연결 안 함</option>
                {linkableAssets.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {asset.displayName}
                    {asset.isFolder ? ` (폴더 · 이미지 ${asset.childAssetIds.length}장)` : ` (${asset.assetId}) · v${asset.version}`}
                  </option>
                ))}
              </select>
            </label>
            {assetId && (
              <>
                {/* A Folder has no versions of its own — its children carry those — so the pin/follow choice
                    has nothing to act on and only invites a decision that changes nothing. Images keep it. */}
                {!selectedAsset()?.isFolder && (
                  <label className="block text-sm text-slate-300">
                    버전 정책
                    <select
                      aria-label="에셋 버전 정책"
                      value={versionPolicy}
                      onChange={(event) => setVersionPolicy(event.target.value as LongStoryBibleAssetLink["versionPolicy"])}
                      className={fieldClassName}
                    >
                      <option value="pinned_version">현재 버전 고정</option>
                      <option value="follow_latest">최신 버전 따라가기</option>
                    </select>
                  </label>
                )}
                <label className="block text-sm text-slate-300">
                  적용 범위
                  <select
                    aria-label="에셋 적용 범위"
                    value={scopeMode}
                    onChange={(event) => setScopeMode(event.target.value as "all" | "episode")}
                    className={fieldClassName}
                  >
                    <option value="all">모든 에피소드</option>
                    <option value="episode">에피소드 하나만</option>
                  </select>
                </label>
                {scopeMode === "episode" && (
                  <label className="block text-sm text-slate-300">
                    에피소드 번호
                    <select aria-label="적용할 에피소드 번호" value={scopeEpisode} onChange={(event) => setScopeEpisode(event.target.value)} className={fieldClassName}>
                      {Array.from({ length: episodeCount ?? 0 }, (_, index) => (
                        <option key={index + 1} value={index + 1}>
                          에피소드 {index + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </fieldset>
        )}
        {submitError && (
          <p role="alert" data-testid="story-bible-submit-error" data-error-code={submitError.code} className="text-sm text-rose-400">
            {submitError.message}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className={primaryButton} disabled={pending}>
            {pending ? "저장하는 중..." : editing ? "변경 사항 저장" : "항목 추가"}
          </button>
          {editing && (
            <button type="button" className={outlineButton} onClick={resetEditor} disabled={pending}>
              취소
            </button>
          )}
        </div>
      </form>

      {deleteTarget && (
        <div role="alertdialog" aria-label="설정집 항목 삭제 확인" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
          <p className="text-sm font-semibold text-amber-300">{deleteTarget.name || deleteTarget.id}을(를) 삭제할까요?</p>
          <p className="text-sm text-slate-300">삭제 전에 한 번 더 확인합니다.</p>
          <div className="flex gap-3">
            <button type="button" className={outlineButton} onClick={() => setDeleteTarget(null)} disabled={pending}>
              취소
            </button>
            <button type="button" className={dangerButton} onClick={() => void confirmDelete()} disabled={pending}>
              {pending ? "삭제하는 중..." : "삭제"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
