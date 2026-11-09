import { ApiRequestError } from '../api/client';
import { notifyError } from '../api/queryClient';

type FormLike = {
  values: object;
  setFieldError: (path: string, error: string) => void;
};

/**
 * Maps an API error onto a @mantine/form form:
 * - `400 VALIDATION_FAILED` → `details.fields[field]` on the matching input (after `remap`).
 * - `409 DUPLICATE_NAME` → `details.field` (default `name`).
 * Returns text for fields the form doesn't have (show it in a form-level alert), else null.
 * Any other error goes to the global notification.
 */
export function applyApiErrors(error: Error, form: FormLike, remap: (field: string) => string = (f) => f) {
  if (error instanceof ApiRequestError && error.code === 'DUPLICATE_NAME') {
    form.setFieldError(typeof error.details.field === 'string' ? error.details.field : 'name', error.message);
    return null;
  }
  if (error instanceof ApiRequestError && error.code === 'VALIDATION_FAILED') {
    const fields = (error.details.fields ?? {}) as Record<string, string>;
    const unmatched: string[] = [];
    for (const [field, message] of Object.entries(fields)) {
      const target = remap(field);
      if (target in form.values) form.setFieldError(target, message);
      else unmatched.push(`${field}: ${message}`);
    }
    return unmatched.length ? unmatched.join('\n') : null;
  }
  notifyError(error);
  return null;
}
