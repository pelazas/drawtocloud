import { useCallback, useState } from "react";
import { DEFAULT_DESCRIBE_FORM, type DescribeFormAnswers } from "./form";

export function useDescribeAppModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<DescribeFormAnswers>({ ...DEFAULT_DESCRIBE_FORM });

  const open = useCallback(() => {
    setForm({ ...DEFAULT_DESCRIBE_FORM });
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const setField = useCallback(
    <K extends keyof DescribeFormAnswers>(key: K, value: DescribeFormAnswers[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const canSubmit = form.description.trim().length > 0;

  return { isOpen, form, open, close, setField, canSubmit };
}
