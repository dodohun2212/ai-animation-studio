import { useRef, useState, type FormEvent } from "react";
import {
  IMAGE_ESTIMATED_COST_USD,
  STORY_ESTIMATED_COST_USD,
  VIDEO_SECOND_ESTIMATED_COST_USD,
  type AspectRatio,
  type Project,
  type RunwayClipDurationSeconds,
  type ShortProjectSettingsInput,
} from "@ai-animation-studio/shared";

import { createProject, toDisplayError, updateProjectSettings } from "../api/projectsApi.js";
import { isSafeProjectId } from "../validation/projectId.js";
import { cardSectionWide as cardSection } from "./ui/surfaces.js";

interface Props {
  onCreated: (project: Project) => void;
  onCancel: () => void;
}

const field =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
/**
 * The shape of a flower reel, decided here rather than asked here.
 *
 * These three used to be selects on this form, and the screen that opens the instant this one succeeds —
 * ShortProjectSettingsScreen, reached by handleCreated — asks for the same three again. They are still
 * editable there: the server returns sceneCountChangeable from `stored.scenes.length === 0` and
 * aspectRatioChangeable from `stored.generated_images.length === 0`, and a project this form just made has
 * neither. So the second screen is not a later moment that the first one was needed for; it is the next
 * screen, with the same controls, unlocked. 캡틴D asked whether one of the two could go, and this is the one:
 * the other is the only place these live for every short project, flower or not.
 *
 * Four five-second scenes rather than two ten-second ones: 씨앗 → 싹 → 봉오리 → 개화. Two scenes jumps from a
 * sprout to a fully open flower in one cut, and that jump remains however steady the pot is. The video cost is
 * identical — the same total length at the same per-second rate — and the images cost $0.20 more, which is
 * what buys the two missing beats. Held back until 장면 이어 그리기 existed, on purpose: with more scenes and
 * no chain, the pot simply changes more times (Cowork Round 617 ④, agreed in CLI Round 618 ④).
 */
const FLOWER_SCENE_COUNT = 4;
const FLOWER_CLIP_DURATION_SECONDS: RunwayClipDurationSeconds = 5;
const FLOWER_ASPECT_RATIO: AspectRatio = "9:16";
const FLOWER_TOTAL_SECONDS = FLOWER_SCENE_COUNT * FLOWER_CLIP_DURATION_SECONDS;

/**
 * 🔴 Every scene needs seventeen fields — visual_action, shot_size, camera_angle and the rest — and those are
 * what the image and video prompts actually read. Nobody types seventeen fields per scene, and an earlier
 * version of this screen tried to skip them: it wrote two fields by hand and the image prompt came out empty,
 * so the project could be created and then refused at the first paid step (CLI Round 609).
 *
 * Story generation is the one thing that fills all seventeen correctly. So this form does not write a script —
 * it writes the *brief* the script is generated from, and hands the project to the ordinary pipeline.
 */
function presetSettings(
  flower: string,
  meaning: string,
  originHint: string,
): ShortProjectSettingsInput {
  const name = flower.trim();
  const known = originHint.trim();
  return {
    projectName: `${name} 꽃말`,
    topic: `${name}의 꽃말 — ${meaning.trim()}`,
    genre: "정보·교양",
    mood: "차분하고 서정적, 잔잔한 경외감",
    // No cast: a flower reel has no character, and a name here would put one in the story prompt.
    character: "",
    lore: "",
    /*
     * 🔴 캡틴D: 「영상을 봤는데 식물이 가만히 있고 성장을 안 하는데?」 — and the brief was half the reason.
     *
     * It described the arc across the reel and said nothing about what has to happen INSIDE one five-second
     * clip. The story model filled the motion fields the way the rest of this preset pointed: 개나리's four
     * scenes all came back `motion_speed: 느림`, `motion_intensity: 약함`, and a slow push-in for every
     * `camera_motion` — which is a shot where the plant is allowed to stand still while the camera and the
     * background do the moving. Those two fields are rendered into the Runway prompt verbatim as
     * `Pacing: motion speed 느림; intensity 약함` (video-preview.service.ts promptFor).
     *
     * So the brief now says the growth is the shot, and says it as a checkable difference between the first and
     * last frame rather than as an adjective.
     */
    /*
     * 🔴 캡틴D: 「식물이 자라면은 그게 이어져서 자연스럽게 성장하는 모습이 되어야 하는데 너무 부자연스러워」.
     *
     * 해바라기 릴의 클립 마지막 프레임 네 장을 실제로 꺼내 보고 알았습니다. 1번 클립이 5초를 「흙이 씨앗을
     * 덮는」 데 쓰고, 끝 프레임은 식물이 아니라 **잿빛 흙 돔** 하나였습니다. 성장 릴의 첫 장면에서 보여 줄
     * 것이 없고, 색까지 탁해진 채로 2번 컷으로 넘어갑니다.
     *
     * 대본 모델이 틀린 게 아니라 시킨 대로 한 것입니다 — 이 줄이 「씨앗이 흙에 심기는 데서 시작」이라고
     * 명시하고 있었습니다. 네 장면 중 하나를 심는 데 쓰면 자랄 몫은 셋뿐이고, 그 셋이 남은 전 과정을
     * 나눠 가져야 해서 컷마다 도약이 커집니다.
     *
     * 시작점을 옮기는 것만으로는 부족합니다. 금지를 같이 적지 않으면 「심기는」이 어떤 표현으로든 다시
     * 돌아옵니다 — 이 preset 이 이미 두 번 배운 것입니다(위의 `아주 느린 접근`, `motion_speed`).
     */
    fullStory:
      `${name}의 꽃말인 "${meaning.trim()}"의 유래와 의미를 설명한다.\n`
      + `화면은 흙에 이미 심긴 ${name} 씨앗에서 싹이 흙을 뚫고 올라오는 데서 시작해, 줄기와 잎이 자라고 `
      + `봉오리가 맺혀 꽃이 활짝 피기까지 한 방향으로 진행한다.\n`
      + `씨앗을 심거나 흙으로 덮는 장면은 넣지 않는다. 첫 장면부터 식물이 이미 자라고 있어야 한다.\n`
      + `각 장면은 식물이 자라는 과정을 압축해 보여주는 타임랩스다. 한 장면 안에서 식물이 눈에 띄게 자라야 하고, `
      + `첫 프레임과 마지막 프레임의 크기·형태가 분명히 달라야 한다. 빛이나 배경만 흔들리고 식물이 그대로인 장면은 안 된다.\n`
      + `한 장면에서는 한 단계만 자란다. 그 장면이 끝난 모습이 다음 장면이 시작하는 모습이 된다.\n`
      + `장면이 넘어가도 같은 ${name}, 같은 자리의 땅, 같은 각도, 같은 빛을 유지한다.\n`
      /*
       * 🔴 캡틴D: 「화분이 아니라 땅에서 자라는 걸 보고싶어」.
       *
       * 화분은 모델이 지어낸 것이 아니라 이 파일이 시킨 것이었습니다 — 이 줄이 「같은 화분」이라고 적고
       * `avoid` 가 「화분이나 배경이 장면마다 바뀌는 것」이라고 적어서, 둘 다 **화분이 있다**를 전제로
       * 읽혔습니다. 실측: 방금 만든 꽃말_구기자 대본에 「화분」이 26번, 「땅」이 0번 나옵니다.
       *
       * 시작점만 바꾸면 부족하다는 것은 바로 위에서 배운 그대로라, 금지를 같이 적습니다.
       */
      + `식물은 화분이 아니라 땅에 뿌리내린 채 자란다. 화분·포트·플랜터는 화면에 넣지 않는다.`
      + (known ? `\n\n유래에 대해 알고 있는 것: ${known}` : ""),
    sceneCount: FLOWER_SCENE_COUNT,
    clipDurationSeconds: FLOWER_CLIP_DURATION_SECONDS,
    /*
     * 🔴 캡틴D: 「읽어줄 문장이 너무 별로야. 시적인 느낌으로, 감성적이게」.
     *
     * 그전까지 이 칸은 내레이션이 **무엇인지**만 정했습니다(해설이다 · 대사가 아니다 · 단정하지 말아라).
     * 말투에 대한 지시는 한 줄도 없었고, 지시가 없으면 모델은 가장 안전한 것 — 정보 나열 — 을 내놓습니다.
     * 버즘나무 대본이 정확히 그랬습니다: 「…입니다. …자라납니다.」
     *
     * 🔴 「시적으로 써라」 한 줄로는 안 됩니다 — 그건 상투어를 불러옵니다(「놀라운 생명력」,
     * 「감탄이 담겨 있습니다」). 그래서 말투를 형용사가 아니라 **규칙**으로 적습니다.
     *
     * 🔴 그리고 캡틴D: 「AI는 금지를 잘 모르지 않아?」 — 맞습니다. 금지어 목록만 주면 모델은 그 단어를
     * 피하면서 **같은 톤의 다른 상투어**를 씁니다. 금지는 하지 말 것만 말하고 할 것은 말하지 않으니까요.
     * 그래서 금지를 **짝**으로 바꿨습니다: 나쁜 문장 → 그 자리에 들어갈 좋은 문장, 그리고 네 장면짜리
     * 형태 예시 하나. 보여주는 것이 막는 것보다 잘 듣습니다.
     *
     * 🔴 그리고 784 에서 그 예시를 **꽃 문장으로 준 것이 틀렸습니다.** 이름만 ○○·△△ 로 비우고
     * 「베끼지 않는다」를 적어 뒀는데, 다음 대본이 네 줄을 **거의 그대로 돌려줬습니다** — 1·3·4 번은 문장째,
     * 2 번은 앞부분째. 심지어 금지했던 「놀라운」이 그 자리에서 같이 돌아왔습니다. 베끼지 말라는 말은 베낄
     * 수 있는 문장을 치우지 못합니다. **쓸 수 있는 자리에 놓인 예시는 쓰입니다.**
     *
     * 그래서 세 가지로 나눴습니다:
     *   ① 나쁜 예 → 오른쪽은 이제 **문장이 아니라 지시**입니다(「움직이는 것 하나만 적는다」). 베낄 것이 없습니다.
     *   ② 네 장면이 각각 **무슨 일을 하는지**만 적습니다. 구조는 주되 단어는 주지 않습니다.
     *   ③ 말투 예시는 **꽃과 무관한 소재**(담·우물·등불)로 둡니다. 리듬은 옮겨 오지만 꽃말 대본에 그대로
     *      들어갈 수는 없는 문장들입니다.
     *
     * 왼쪽의 나쁜 예들은 지어낸 게 아니라 실제로 나온 대본에서 그대로 가져왔습니다 — 모델이 실제로 간 길을
     * 보여주는 것이 일반론보다 잘 듣습니다. 「심기는」과 「화분」이 이 preset 에서 이미 두 번 가르친 것입니다.
     *
     * 🔴 캡틴D: 「중국 시인 두보의 말투로」. 이름 하나로 끝내지 않고 **그 말투가 무엇인지** 네 줄로 풀어
     * 적습니다 — 대구 · 감정을 적지 않음 · 시간을 사물로만 말함 · 꾸밈을 덜어냄. 이름만 주면 모델은 자기가
     * 아는 「시적인 것」으로 돌아가고, 그게 지금까지 두 번 실패한 지점입니다. 「~다」 종결도 같이 적습니다:
     * 두보의 담담함은 문장 끝에서 제일 많이 무너집니다.
     *
     * 🟠 예시 두 줄은 두보의 실제 시구가 아니라 **그 형태로 새로 쓴 문장**입니다. 실제 시구(「國破山河在」
     * 같은)를 적으면 모델이 그걸 그대로 돌려줄 수 있고, 그건 이 preset 이 785 에서 이미 당한 일입니다.
     *
     * 🟠 유래를 단정하지 말라는 줄은 그대로 남습니다. 말투가 감성적이라고 사실이 느슨해져서는 안 되고,
     * 그 둘이 부딪히는 자리라 순서가 아니라 **둘 다**임을 적어 둡니다.
     */
    additionalNotes:
      `내레이션은 꽃말과 그 유래를 설명하는 해설이다. 등장인물의 대사가 아니다.\n`
      + `말투는 당나라 시인 두보(杜甫)의 한시를 한국어로 옮긴 것처럼 쓴다. 다음이 그 말투다.\n`
      + `  두 구절을 나란히 놓아 서로 비추게 한다. 한쪽이 크면 다른 쪽은 작다.\n`
      + `  감정을 적지 않는다. 사물과 그 상태만 적으면 감정은 읽는 사람에게서 일어난다.\n`
      + `  시간이 흘렀다는 것을 오직 사물의 변화로만 말한다.\n`
      + `  꾸미는 말을 덜어내고 명사와 움직임을 남긴다. 형용사는 꼭 필요할 때만 하나.\n`
      + `  문장은 "~다"로 끝내 담담하게 맺는다.\n`
      + `한 장면에 한두 문장, 문장은 짧게. 화면에 실제로 보이는 것(빛·흙·싹·잎·봉오리)을 먼저 적고, 거기서 꽃말로 건너간다.\n`
      + `감정은 이름 붙이지 말고 장면으로 보여준다.\n`
      + `아래 왼쪽처럼 쓰지 말고, 오른쪽이 시키는 대로 한다.\n`
      + `  "작은 싹도 놀라운 생명력으로 자라납니다" → 지금 화면에서 실제로 움직이는 것 하나만 적는다\n`
      + `  "~에 대한 감탄이 담겨 있습니다" → 아직 오지 않은 것을 적어서 기다리게 한다\n`
      + `  "가능성을 활짝 펼치는 힘인지도 모릅니다" → 설명을 덧붙이지 말고 한 문장으로 끊는다\n`
      + `  "~라는 뜻입니다" → 뜻을 말하지 말고, 장면이 그 뜻이 되게 둔다\n`
      + `네 장면은 하는 일이 서로 다르다.\n`
      + `  1 화면에서 지금 일어나는 일 하나. 그리고 꽃말을 처음 꺼낸다.\n`
      + `  2 자라는 모습에서 그 말이 어떻게 나왔는지.\n`
      + `  3 아직 오지 않은 것 하나. 닫혀 있음, 기다림.\n`
      + `  4 열린 뒤의 한 문장. 꽃말을 다시 설명하지 말고, 그 말이 무엇이었는지 느끼게 한다.\n`
      + `네 문장은 길이도 구조도 서로 달라야 한다. 같은 말로 시작하는 문장을 두 번 쓰지 않는다.\n`
      + `말투만 참고할 예시다. 꽃과 상관없는 문장이고, 여기 쓰인 단어는 가져다 쓰지 않는다.\n`
      + `  "담은 낮아졌고, 우물은 깊어졌다."\n`
      + `  "등불 하나가 스무 해를 건너왔다."\n`
      // 🔴 The one prompt-level defence against an invented origin. It does not replace the script review —
      // that is where 캡틴D actually corrects a wrong fact, before any image is paid for — but a model told to
      // hedge writes "전해진다" instead of a confident date, and a hedge is far easier to spot and fix.
      + `말투가 감성적이어도 사실은 느슨해지지 않는다. 확실하지 않은 유래는 단정하지 말고 "전해진다" 처럼 쓴다.`,
    styleNotes: {
      visualStyle: "사실적인 식물 성장 타임랩스, 자연 접사, 얕은 심도",
      color: "따뜻한 아침 햇빛, 부드러운 초록과 흙빛",
      lighting: "부드러운 역광의 아침 햇살",
      /*
       * 🔴 「아주 느린 접근」 was here, and it is what the story model copied into all four scenes.
       *
       * Two things were conflated: the camera should hold still (a moving camera makes the between-scene match
       * harder, which is the problem this preset was built around), and the SUBJECT should move a lot. Written
       * as one line about slowness, the model applied the slowness to both — and a slow push-in is also
       * Runway's cheapest way to satisfy "some motion happened" without animating the growth at all.
       *
       * Now it asks for a locked-off camera and nothing else, so the only thing left that can move is the plant.
       */
      camera: "삼각대에 고정된 카메라. 프레임·각도·거리를 처음부터 끝까지 그대로 두고 움직이지 않는다",
      dialogue: "",
      // 🔴 This one is not decoration, and its reason changed today. It used to read 「nothing carries the
      // previous clip's last frame forward」, which was true until 장면 이어 그리기 existed — 캡틴D reported
      // exactly that as the planting spot changing between scenes. The chain (below) now hands scene N the picture scene
      // N-1 became, so this line is no longer the only thing holding the flower steady; it is what keeps the
      // things that must never appear out of every frame. `avoid` is one of the four style fields that
      // actually reach the image prompt.
      avoid: "사람, 손, 글자, 로고, 화분·포트·플랜터 같은 심는 용기. 그리고 배경이 장면마다 바뀌는 것",
      aspect: FLOWER_ASPECT_RATIO,
    },
    narrationEnabled: true,
    subtitlesEnabled: true,
    // On for this preset and off by default everywhere else, which is the whole distinction the setting was
    // built around: a story that changes place between scenes is held back by the previous picture, and a
    // flower reel is the opposite — one flower, one patch of ground, one light, a single forward movement. The
    // brief above already asks for 「장면이 넘어가도 같은 자리의 땅」; this is what lets the pictures obey it.
    sceneImageContinuityEnabled: true,
  };
}

/**
 * 꽃말 릴스 — a preset, not a second pipeline.
 *
 * It creates an ordinary short project and fills in the brief a flower reel needs: the seed-to-bloom arc, the
 * look, the scene count. Everything after that is the path every short project already takes, which is the
 * point — 599 claimed the pipeline was reused and it was only half true, because the scenes themselves were
 * not built the way the pipeline reads them.
 */
export function CreateFlowerReelForm({ onCreated, onCancel }: Props) {
  const [flowerName, setFlowerName] = useState("");
  const [meaning, setMeaning] = useState("");
  const [originHint, setOriginHint] = useState("");
  const [projectId, setProjectId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  /**
   * The project exists but its preset did not save.
   *
   * 🔴 Two calls, and only the first is irreversible — a folder now exists on disk under that name. Sending
   * someone back to a form whose button would fail on a duplicate name, or navigating on silently and letting
   * them wonder why every field is empty, are both worse than saying it and offering the way forward.
   */
  const [created, setCreated] = useState<Project | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Same guard as CreateProjectForm's: state updates are batched, so two fast clicks can both read false.
  const submittingRef = useRef(false);

  const suggestedId = flowerName.trim() ? `꽃말_${flowerName.trim().replace(/\s+/g, "_")}` : "";
  const effectiveId = (idTouched ? projectId : suggestedId).trim();
  const idUsable = effectiveId.length > 0 && isSafeProjectId(effectiveId);
  const ready = idUsable && flowerName.trim().length > 0 && meaning.trim().length > 0;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submittingRef.current || !ready) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    let project = created;
    try {
      // Skipped when a previous attempt already made the folder — creating it again would only ever return
      // PROJECT_ALREADY_EXISTS about the project this very screen just made.
      if (!project) {
        project = (await createProject({ projectId: effectiveId, topic: `${flowerName.trim()}의 꽃말 — ${meaning.trim()}` })).project;
        setCreated(project);
      }
      await updateProjectSettings(project.id, {
        settings: presetSettings(flowerName, meaning, originHint),
      });
      onCreated(project);
    } catch (caught) {
      setError(toDisplayError(caught));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-8 max-w-2xl space-y-5" onSubmit={(event) => void submit(event)} noValidate>
      <section aria-label="꽃과 꽃말" className={cardSection}>
        <label className="block text-sm text-slate-300" htmlFor="flower-name">
          꽃 이름
          <input
            id="flower-name"
            data-testid="flower-name"
            className={field}
            value={flowerName}
            disabled={submitting}
            placeholder="장미"
            onChange={(event) => setFlowerName(event.target.value)}
          />
        </label>

        <label className="block text-sm text-slate-300" htmlFor="flower-meaning">
          꽃말
          <input
            id="flower-meaning"
            data-testid="flower-meaning"
            className={field}
            value={meaning}
            disabled={submitting}
            placeholder="열정"
            onChange={(event) => setMeaning(event.target.value)}
          />
        </label>

        <label className="block text-sm text-slate-300" htmlFor="flower-origin">
          유래 — 알고 계신 것 (선택)
          <textarea
            id="flower-origin"
            data-testid="flower-origin"
            className={field}
            rows={3}
            value={originHint}
            disabled={submitting}
            placeholder="비워 두시면 AI가 알아서 씁니다. 적어 두시면 그 내용을 씁니다."
            onChange={(event) => setOriginHint(event.target.value)}
          />
        </label>
        {/* 🔴 The honest limit of this field, said before the money rather than after it. A model asked for a
            fact returns something shaped like one, and the free script-review step is where that gets caught. */}
        <p className="text-xs text-slate-500" data-testid="flower-origin-note">
          꽃말의 유래는 사실이라 AI가 그럴듯하게 지어낼 수 있습니다. 대본이 나오면 <span className="text-slate-300">이미지를 만들기 전에 고치실 수 있습니다</span> — 그 단계는 무료입니다.
        </p>

        <label className="block text-sm text-slate-300" htmlFor="flower-project-id">
          폴더 이름
          <input
            id="flower-project-id"
            data-testid="flower-project-id"
            className={field}
            value={idTouched ? projectId : suggestedId}
            disabled={submitting || created !== null}
            onChange={(event) => { setIdTouched(true); setProjectId(event.target.value); }}
          />
        </label>
        <p className="text-xs text-slate-500">한글·영문·숫자와 _ - 를 쓸 수 있고 띄어쓰기는 쓸 수 없습니다. 만든 뒤에는 바꿀 수 없습니다.</p>
        {effectiveId.length > 0 && !isSafeProjectId(effectiveId) && (
          <p data-testid="flower-id-invalid" className="text-xs text-rose-400">
            띄어쓰기와 문장부호는 폴더 이름에 쓸 수 없습니다. 예: 꽃말_장미
          </p>
        )}
      </section>

      {/*
        * What the form no longer asks, said once so the shape is not a surprise on the next screen.
        *
        * The three selects that used to sit here (장면 수 · 장면당 길이 · 화면 비율) are the same three the
        * settings screen shows the instant this form succeeds, still unlocked. Asking twice in a row made this
        * form long and taught nothing; this line states the preset and points at where it is changed.
        */}
      <p className="text-sm text-slate-400" data-testid="flower-shape-note">
        <span className="font-semibold text-slate-100 tabular-nums">
          {FLOWER_SCENE_COUNT}장면 × {FLOWER_CLIP_DURATION_SECONDS}초 = {FLOWER_TOTAL_SECONDS}초
        </span>
        , 세로 화면({FLOWER_ASPECT_RATIO})으로 맞춰 둡니다 — 씨앗 · 싹 · 봉오리 · 개화.{" "}
        <span className="text-slate-300">바꾸시려면 다음 설정 화면에서 바꾸시면 됩니다.</span>
      </p>
      <p className="text-sm text-slate-400" data-testid="flower-seam-note">
        장면마다 영상을 따로 만들기 때문에 <span className="font-semibold text-slate-100">이음매마다 꽃 모양이 조금 달라질 수 있습니다.</span>
        {" "}장면을 적게, 길게 잡을수록 그 자리가 줄어듭니다 — 그것도 다음 설정 화면에서 바꾸실 수 있습니다.
      </p>

      {/* 🔴 This sentence used to say the opposite — "여기까지는 비용이 들지 않습니다" — and it was true only
          while this form wrote the script itself. The script now comes from a paid call, so the old line would
          be a screen promising something it no longer does, on the button that spends the money. */}
      <p className="text-sm text-slate-400" data-testid="flower-cost-note">
        <span className="font-semibold text-slate-100">만들면 곧바로 대본 생성(${STORY_ESTIMATED_COST_USD.toFixed(2)})이 이어집니다.</span>{" "}
        이미지와 영상은 그 뒤에 따로 확인하고 만듭니다. 각 단계마다 금액이 나옵니다.
      </p>

      {/*
       * What the whole thing costs, said once, before the first cent.
       *
       * Every step already states its own price at the moment it charges — and that is exactly why nobody ever
       * saw the total: it arrived in four pieces, each after the previous one was already spent. 캡틴D finished
       * a reel and only then knew what a reel costs.
       *
       * Fixed now rather than reactive: the two controls this number used to follow moved to the settings
       * screen, which opens the moment this form succeeds and has them unlocked. So this is the price of the
       * preset as offered, and the last line says where it changes — a total that quietly stops being the
       * total is exactly the failure this paragraph was added to prevent.
       *
       * Deliberately says 약: these are the app's own per-step estimates, the same ones each confirmation panel
       * shows, and the provider bills what it bills. Voice is left out because it is off unless someone turns it
       * on later, and a total that includes what you did not ask for is not the total you will be charged.
       */}
      <p className="text-sm text-slate-400" data-testid="flower-total-cost">
        다 만들면{" "}
        <span className="font-semibold text-slate-100 tabular-nums">
          약 ${(STORY_ESTIMATED_COST_USD + FLOWER_SCENE_COUNT * IMAGE_ESTIMATED_COST_USD + FLOWER_TOTAL_SECONDS * VIDEO_SECOND_ESTIMATED_COST_USD).toFixed(2)}
        </span>{" "}
        <span className="text-slate-500 tabular-nums">
          (대본 ${STORY_ESTIMATED_COST_USD.toFixed(2)} + 이미지 {FLOWER_SCENE_COUNT}장 ${(FLOWER_SCENE_COUNT * IMAGE_ESTIMATED_COST_USD).toFixed(2)}
          {" "}+ 영상 {FLOWER_TOTAL_SECONDS}초 ${(FLOWER_TOTAL_SECONDS * VIDEO_SECOND_ESTIMATED_COST_USD).toFixed(2)})
        </span>
        {" "}— 단계마다 다시 여쭙고, 중간에 그만두셔도 됩니다.
        {" "}설정 화면에서 장면 수나 길이를 바꾸시면 이 금액도 그만큼 달라집니다.
      </p>

      {created !== null && error !== null && (
        <p role="alert" data-testid="flower-partial" className="text-sm text-amber-300">
          프로젝트 「{created.id}」는 만들어졌습니다. 서식 값을 저장하는 데만 실패했으니, 다시 시도하시거나 설정 화면에서 직접 채우셔도 됩니다.
        </p>
      )}
      {error && (
        <p role="alert" data-testid="flower-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          data-testid="flower-submit"
          disabled={!ready || submitting}
          className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
        >
          {submitting ? "만드는 중..." : created !== null ? "서식 값 다시 저장" : "꽃말 릴스 만들기"}
        </button>
        <button
          type="button"
          className="rounded-full border border-white/10 px-5 py-2.5 text-sm text-slate-300 hover:bg-white/5"
          disabled={submitting}
          onClick={onCancel}
        >
          취소
        </button>
      </div>
    </form>
  );
}
