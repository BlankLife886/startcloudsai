// Keep the layout of a visible, active batch stable as individual images finish.
export function resolveStageGroupAspect({ key, count, active, requested, measured }, previous) {
  const locked = count > 1 && (active || (previous?.key === key && previous.locked));
  return {
    key,
    locked,
    aspect: locked ? previous?.key === key && previous.locked ? previous.aspect : requested : measured,
  };
}
