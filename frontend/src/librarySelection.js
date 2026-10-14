// An export belongs to one recording source and one local calendar day.
// A date filter supplies that day for files that cross midnight.
export function sameExportScope(clip, anchor, exportDate = '') {
  return !!clip && !!anchor && clip.sourceId === anchor.sourceId &&
    (exportDate || clip.date) === (exportDate || anchor.date);
}

export function exportableClip(clip) {
  return !!clip && (!clip.availability || clip.availability === 'available');
}

export function librarySelection(clips, selectedIds, focused, exportDate = '') {
  const ids = new Set(selectedIds);
  const chosen = clips.filter(clip => ids.has(clip.id));
  const anchor = chosen[0] || focused;
  const eligible = clips.filter(clip => exportableClip(clip) && sameExportScope(clip, anchor, exportDate));
  return {
    chosen, anchor, eligible,
    compatible: chosen.every(clip => exportableClip(clip) && sameExportScope(clip, anchor, exportDate)),
    allSelected: eligible.length > 0 && eligible.every(clip => ids.has(clip.id)),
  };
}

export function toggleLibraryClip(clips, selectedIds, clip, exportDate = '') {
  if (selectedIds.includes(clip.id)) return selectedIds.filter(id => id !== clip.id);
  const { anchor, chosen } = librarySelection(clips, selectedIds, clip, exportDate);
  if (!exportableClip(clip) || (chosen.length && !sameExportScope(clip, anchor, exportDate))) return selectedIds;
  return [...selectedIds, clip.id];
}
