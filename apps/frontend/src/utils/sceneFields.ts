/**
 * The one definition of a scene's editable fields, shared by the short project and long-form Episodes.
 *
 * These are the same seventeen fields on both sides — the short project's scene-edit endpoint spells them in
 * snake_case, a long Episode's stored script spells them in camelCase, and `narration` exists only in short
 * projects (long-form Episodes have no narration or subtitles). Keeping one definition is what stops the two
 * screens from drifting apart again: they were built separately, and the long one ended up editing raw JSON
 * while the short one grew labelled fields and cost warnings.
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
    fields: [{ key: "narration", longKey: null, label: "읽어줄 문장", multiline: true }],
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
 * them. Groups that end up empty (narration) are dropped rather than shown with nothing in them.
 */
export function longEpisodeFieldGroups(): { title: string; impact: string; free?: boolean; fields: { key: string; label: string; multiline?: boolean }[] }[] {
  return SCENE_FIELD_GROUPS.map((group) => ({
    title: group.title,
    impact: group.impact,
    ...(group.free === undefined ? {} : { free: group.free }),
    fields: group.fields
      .filter((field): field is SceneEditableField & { longKey: string } => field.longKey !== null)
      .map((field) => ({ key: field.longKey, label: field.label, ...(field.multiline === undefined ? {} : { multiline: field.multiline }) })),
  })).filter((group) => group.fields.length > 0);
}
