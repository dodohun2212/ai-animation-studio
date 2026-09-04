/**
 * The one definition of a scene's editable fields, shared by the short project and long-form Episodes.
 *
 * These are the same seventeen fields on both sides — the short project's scene-edit endpoint spells them in
 * snake_case and a long Episode's stored script spells them in camelCase. Keeping one definition is what stops
 * the two screens from drifting apart again: they were built separately, and the long one ended up editing raw
 * JSON while the short one grew labelled fields and cost warnings.
 *
 * `narration` used to be short-only and is now on both sides, but it stays marked `longOptional`: every Episode
 * script stored before narration existed simply has no such key, and those scripts must keep loading.
 *
 * The grouping is the substance, not decoration. The endpoints accept one flat set of fields, but editing them
 * does not cost the same: changing a composition field means paying to regenerate an image (and the video built
 * from it), while changing the on-screen script costs nothing. `impact` states that before the edit, not after.
 */

export interface SceneEditableField {
  /** Field name in the short project's scene-edit request body. */
  key: string;
  /** The same field on a long Episode's script scene. null for fields long-form Episodes do not have. */
  longKey: string | null;
  label: string;
  multiline?: boolean;
  /**
   * True when a long Episode's stored script is allowed to omit this key entirely. Anything reading a script
   * must accept `undefined` here, not just an empty string — a script written before the field existed has no
   * key at all, and rejecting those would lock the user out of their own saved Episodes.
   */
  longOptional?: boolean;
}

export interface SceneFieldGroup {
  title: string;
  /** What editing anything in this group forces to be made again. */
  impact: string;
  /** True when nothing has to be regenerated — shown in a calm colour rather than as a warning. */
  free?: boolean;
  fields: SceneEditableField[];
}

export const SCENE_FIELD_GROUPS: SceneFieldGroup[] = [
  {
    title: "화면 대본",
    impact: "고쳐도 다시 만들 것이 없습니다.",
    free: true,
    fields: [{ key: "description", longKey: "description", label: "장면 대본", multiline: true }],
  },
  {
    title: "내레이션 문장",
    impact: "고치면 이 장면의 음성을 다시 만들어야 합니다.",
    fields: [{ key: "narration", longKey: "narration", label: "읽어줄 문장", multiline: true, longOptional: true }],
  },
  {
    title: "구도",
    impact: "고치면 이 장면의 이미지를 다시 만들어야 하고, 그 이미지로 만든 영상도 다시 만들어야 합니다.",
    fields: [
      { key: "visual_action", longKey: "visualAction", label: "화면에 보이는 행동", multiline: true },
      { key: "shot_size", longKey: "shotSize", label: "샷 크기" },
      { key: "camera_angle", longKey: "cameraAngle", label: "카메라 앵글" },
      { key: "composition", longKey: "composition", label: "구도" },
      { key: "lens_feel", longKey: "lensFeel", label: "렌즈 느낌" },
      { key: "focus_subject", longKey: "focusSubject", label: "초점 대상" },
    ],
  },
  {
    title: "움직임",
    impact: "고치면 이 장면의 영상을 다시 만들어야 합니다. 이미지는 그대로 쓸 수 있습니다.",
    fields: [
      { key: "start_motion", longKey: "startMotion", label: "시작 동작" },
      { key: "main_motion", longKey: "mainMotion", label: "주요 동작" },
      { key: "expression_change", longKey: "expressionChange", label: "표정 변화" },
      { key: "camera_motion", longKey: "cameraMotion", label: "카메라 움직임" },
      { key: "environment_motion", longKey: "environmentMotion", label: "배경 움직임" },
      { key: "motion_speed", longKey: "motionSpeed", label: "움직임 속도" },
      { key: "motion_intensity", longKey: "motionIntensity", label: "움직임 강도" },
    ],
  },
  {
    title: "다음 장면과의 연결",
    impact: "고치면 이 장면과 다음 장면의 영상을 모두 다시 만들어야 합니다.",
    fields: [
      { key: "end_motion", longKey: "endMotion", label: "마무리 동작" },
      { key: "continuity_hint", longKey: "continuityHint", label: "이어짐 힌트" },
    ],
  },
];

/** Every field the short project's scene-edit endpoint accepts, in display order. */
export const SCENE_FIELD_KEYS = SCENE_FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.key));

/**
 * The same groups reduced to the fields a long Episode's script actually has, keyed the way that script spells
 * them. A group that ends up with no fields is dropped rather than shown empty — no group is in that position
 * today, but the filter stays so that removing a field from long Episodes cannot leave a headed empty box.
 *
 * `optional` is carried through deliberately: callers validating a stored script must treat those keys as
 * "absent or string", never "string". See SceneEditableField.longOptional.
 */
export function longEpisodeFieldGroups(): { title: string; impact: string; free?: boolean; fields: { key: string; label: string; multiline?: boolean; optional?: boolean }[] }[] {
  return SCENE_FIELD_GROUPS.map((group) => ({
    title: group.title,
    impact: group.impact,
    ...(group.free === undefined ? {} : { free: group.free }),
    fields: group.fields
      .filter((field): field is SceneEditableField & { longKey: string } => field.longKey !== null)
      .map((field) => ({
        key: field.longKey,
        label: field.label,
        ...(field.multiline === undefined ? {} : { multiline: field.multiline }),
        ...(field.longOptional === undefined ? {} : { optional: field.longOptional }),
      })),
  })).filter((group) => group.fields.length > 0);
}

/**
 * Plain-language label for a Runway output ratio.
 *
 * The raw value ("720:1280") is what the provider wants and means nothing to the person deciding whether to
 * spend money on it — what they picked in project settings was "9:16" or "16:9". Both are shown: the shape in
 * words, and the exact value the request will carry.
 */
export function videoRatioLabel(ratio: string): string {
  if (ratio === "1280:720") return `가로형 16:9 (${ratio})`;
  if (ratio === "720:1280") return `세로형 9:16 (${ratio})`;
  return ratio;
}
