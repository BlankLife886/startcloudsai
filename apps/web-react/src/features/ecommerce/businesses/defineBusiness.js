export function defineCommerceBusiness(id) {
  const namespace = `commerce.business.${id}.v1`;
  return Object.freeze({
    id,
    stateNamespace: namespace,
    draftNamespace: `${namespace}.draft`,
    taskKind: `ui-design-ecommerce-${id}-generation`,
  });
}
