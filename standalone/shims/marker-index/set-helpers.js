let setEqual = function(a, b) {
  let next;
  if (a.size !== b.size) { return false; }
  let iterator = a.values();
  while (!(next = iterator.next()).done) {
    if (!b.has(next.value)) { return false; }
  }
  return true;
};

let subtractSet = function(set, valuesToRemove) {
  if (set.size > valuesToRemove.size) {
    return valuesToRemove.forEach(value => set.delete(value));
  } else {
    return set.forEach(function(value) { if (valuesToRemove.has(value)) { return set.delete(value); } });
  }
};

let addSet = (set, valuesToAdd) => valuesToAdd.forEach(value => set.add(value));

let intersectSet = (set, other) => set.forEach(function(value) { if (!other.has(value)) { return set.delete(value); } });

modules.export = { setEqual, subtractSet, addSet, intersectSet };
