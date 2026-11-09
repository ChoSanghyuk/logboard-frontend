import type { components } from '../api/schema';

type Crop = components['schemas']['CropDto'];
type Status = components['schemas']['ErrorLogSummary']['status'];

/** Why each expand button is disabled (null = enabled). Checked in order: status, maxLines, file bounds. */
export function expandBlockers(crop: Crop, status: Status): { before: string | null; after: string | null } {
  if (status !== 'CROPPED') {
    const reason = 'The crop can only change while the error log is CROPPED.';
    return { before: reason, after: reason };
  }
  if (crop.endLine - crop.startLine + 1 >= crop.maxLines) {
    const reason = `The crop is at the ${crop.maxLines.toLocaleString('en-US')}-line limit.`;
    return { before: reason, after: reason };
  }
  return {
    before: crop.startLine <= 1 ? 'Already at the start of the file.' : null,
    after: crop.endLine >= crop.totalLines ? 'Already at the end of the file.' : null,
  };
}

export const cropText = (crop: Crop) => crop.lines.map((l) => l.text).join('\n');
