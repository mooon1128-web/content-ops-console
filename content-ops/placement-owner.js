const ownerKeys = new Set(['owner', 'ownerId', 'ownerUsername']);
// Ownership is attached at creation; another colleague editing a record does not take it over.
export function bindPlacementOwners(operations, user) {
  if (!Array.isArray(operations)) return operations;
  return operations.map(op => {
    if (op?.group !== 'placements') return op;
    if (op.kind === 'add' && op.after) return {...op, after: {...op.after,
      owner: user.name || user.username, ownerId: user.id, ownerUsername: user.username}};
    if (op.kind === 'field' && ownerKeys.has(op.key)) {
      throw Object.assign(new Error('负责人由创建账号绑定，不能在投放表单中改为他人'), {status: 403});
    }
    return op;
  });
}
