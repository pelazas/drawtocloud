type ManualLayoutPolicyInput = {
  readOnly: boolean;
  isGenerating: boolean;
};

export function canApplyManualLayout(input: ManualLayoutPolicyInput): boolean {
  if (input.readOnly) return false;
  if (input.isGenerating) return false;
  return true;
}
