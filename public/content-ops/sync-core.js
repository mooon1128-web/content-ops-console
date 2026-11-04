// Three-way merge: apply only changes made since the client's last shared snapshot.
(() => {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function mergeStates(base, local, remote) {
    const conflicts = [];
    function merge(b, l, r, path = "") {
      if (same(l, b)) return r;
      if (same(r, b) || same(l, r)) return l;
      if (object(b) && object(l) && object(r)) {
        const result = {};
        for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
          const value = key === "updatedAt" || key === "clientUpdatedAt" ? r[key]
            : merge(b[key], l[key], r[key], `${path}/${key}`);
          if (value !== undefined) result[key] = value;
        }
        return result;
      }
      const keyed = rows => Array.isArray(rows) && rows.every(row => object(row) && typeof row.id === "string" && row.id)
        && new Set(rows.map(row => row.id)).size === rows.length;
      if (keyed(b) && keyed(l) && keyed(r)) {
        const bm = new Map(b.map(row => [row.id, row]));
        const lm = new Map(l.map(row => [row.id, row]));
        const rm = new Map(r.map(row => [row.id, row]));
        return [...new Set([...rm.keys(), ...lm.keys(), ...bm.keys()])]
          .map(id => merge(bm.get(id), lm.get(id), rm.get(id), `${path}/${id}`))
          .filter(row => row !== undefined);
      }
      conflicts.push(path);
      return l;
    }
    return { state: merge(base, local, remote), conflicts };
  }
  globalThis.ContentOpsSync = { mergeStates, same };
})();
