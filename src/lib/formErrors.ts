import { ApiRequestError } from '../api/client';
import { notifyError } from '../api/queryClient';

type FormLike = {
  values: object;
  setFieldError: (path: string, error: string) => void;
};

/** Bean-validation path → @mantine/form path: `instances[1].host` → `instances.1.host`. */
const toFormPath = (field: string) => field.replace(/\[(\d+)\]/g, '.$1');

/** True if `path` (`a.1.b`) names a field in `values`. */
function hasPath(values: object, path: string) {
  let node: unknown = values;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object' || !(key in node)) return false;
    node = (node as Record<string, unknown>)[key];
  }
  return true;
}

/**
 * Maps an API error onto a @mantine/form form:
 * - `400 VALIDATION_FAILED` → `details.fields[field]` on the matching input, also nested ones
 *   (`instances[1].host` → `instances.1.host`), after `remap` (which gets the form path).
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
      const target = remap(toFormPath(field));
      if (hasPath(form.values, target)) form.setFieldError(target, message);
      else unmatched.push(`${field}: ${message}`);
    }
    return unmatched.length ? unmatched.join('\n') : null;
  }
  notifyError(error);
  return null;
}
