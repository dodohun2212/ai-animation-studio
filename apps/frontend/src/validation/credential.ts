export type CredentialValidationResult = { value: string } | { error: string };
export function validateCredentialInput(rawValue: string): CredentialValidationResult {
  const value = rawValue.trim();
  if (!value) return { error: "credential 값을 입력하세요." };
  if (value.length < 20) return { error: "credential은 20자 이상이어야 합니다." };
  if (/\s/.test(value)) return { error: "credential에는 공백을 포함할 수 없습니다." };
  return { value };
}
