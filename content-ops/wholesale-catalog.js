// Match the ordering portal's saved product overrides, including new and deleted products.
export function currentWholesaleProducts(base, data = {}) {
  const settings = data.productSettings || {}, inventory = data.inventory || {};
  const rows = new Map();
  for (const product of [...base, ...(data.customProducts || [])]) {
    if (!product?.id) continue;
    const setting = settings[product.id] || {};
    if (setting.deleted) { rows.delete(product.id); continue; }
    rows.set(product.id, {...product, ...setting, id: product.id,
      status: inventory[product.id] ?? setting.status ?? product.status,
      image: setting.image || product.image || ''});
  }
  return [...rows.values()];
}

// Only mapped public catalog fields leave this endpoint for PR/content staff.
export function catalogCostInfo(user, product, data, resolveCost) {
  return user.role === 'admin' ? resolveCost(product, data.costSettings || {}, data.costSeeds || {}) : {};
}
