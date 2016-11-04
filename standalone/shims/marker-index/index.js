const Point = require("./point");
const Range = require("./range");
const { last, extend } = require("underscore-plus");
const { addSet, subtractSet, intersectSet, setEqual } = require("./set-helpers");

let BRANCHING_THRESHOLD = 3;

class Node {
  constructor(children) {
    this.children = children;
    this.ids = new Set;
    this.extent = Point.ZERO;
    for (let child of this.children) {
      this.extent = this.extent.traverse(child.extent);
      addSet(this.ids, child.ids);
    }
  }

  insert(ids, start, end) {
    let newNodes;
    let rangeIsEmpty = start.compare(end) === 0;
    let childEnd = Point.ZERO;
    let i = 0;
    while (i < this.children.length) {
      let newChildren;
      let child = this.children[i++];
      let childStart = childEnd;
      childEnd = childStart.traverse(child.extent);

      switch (childEnd.compare(start)) {
        case -1: var childPrecedesRange = true; break;
        case 1:  childPrecedesRange = false; break;
        case 0:
          if (child.hasEmptyRightmostLeaf()) {
            childPrecedesRange = false;
          } else {
            childPrecedesRange = true;
            if (rangeIsEmpty) {
              ids = new Set(ids);
              child.findContaining(child.extent, ids);
            }
          }
          break;
      }
      if (childPrecedesRange) { continue; }

      switch (childStart.compare(end)) {
        case -1: var childFollowsRange = false; break;
        case 1:  childFollowsRange = true; break;
        case 0:  childFollowsRange = !(child.hasEmptyLeftmostLeaf() || rangeIsEmpty); break;
      }
      if (childFollowsRange) { break; }

      let relativeStart = Point.max(Point.ZERO, start.traversalFrom(childStart));
      let relativeEnd = Point.min(child.extent, end.traversalFrom(childStart));
      if (newChildren = child.insert(ids, relativeStart, relativeEnd)) {
        this.children.splice(i - 1, 1, ...newChildren);
        i += newChildren.length - 1;
      }
      if (rangeIsEmpty) { break; }
    }

    if (newNodes = this.splitIfNeeded()) {
      return newNodes;
    } else {
      addSet(this.ids, ids);
      return;
    }
  }

  delete(id) {
    if (!this.ids.delete(id)) { return; }
    let i = 0;
    return (() => {
      let result = [];
      while (i < this.children.length) {
        let item;
        this.children[i].delete(id);
        if (!this.mergeChildrenIfNeeded(i - 1)) { item = i++; }
        result.push(item);
      }
      return result;
    })();
  }

  splice(position, oldExtent, newExtent, exclusiveIds, precedingIds, followingIds) {
    let oldRangeIsEmpty = oldExtent.isZero();
    let spliceOldEnd = position.traverse(oldExtent);
    let spliceNewEnd = position.traverse(newExtent);
    let extentAfterChange = this.extent.traversalFrom(spliceOldEnd);
    this.extent = spliceNewEnd.traverse(Point.max(Point.ZERO, extentAfterChange));

    if (position.isZero() && oldRangeIsEmpty) {
      __guard__(precedingIds, x => x.forEach(id => {
        if (!exclusiveIds.has(id)) {
          return this.ids.add(id);
        }
      }
      ));
    }

    let i = 0;
    let childEnd = Point.ZERO;
    while (i < this.children.length) {
      let child = this.children[i];
      let childStart = childEnd;
      childEnd = childStart.traverse(child.extent);

      switch (childEnd.compare(position)) {
        case -1: var childPrecedesRange = true; break;
        case 0:  childPrecedesRange = !(child.hasEmptyRightmostLeaf() && oldRangeIsEmpty); break;
        case 1:  childPrecedesRange = false; break;
      }

      if (!childPrecedesRange) {
        if (remainderToDelete != null) {
          if (remainderToDelete.isPositive()) {
            let previousExtent = child.extent;
            child.splice(Point.ZERO, remainderToDelete, Point.ZERO);
            var remainderToDelete = remainderToDelete.traversalFrom(previousExtent);
            childEnd = childStart.traverse(child.extent);
          }
        } else {
          if (oldRangeIsEmpty) {
            let left;
            let left1;
            var previousChildIds = (left = __guard__(this.children[i - 1], x1 => x1.getRightmostIds())) != null ? left : precedingIds;
            var nextChildIds = (left1 = __guard__(this.children[i + 1], x2 => x2.getLeftmostIds())) != null ? left1 : followingIds;
          }
          let splitNodes = child.splice(
            position.traversalFrom(childStart),
            oldExtent,
            newExtent,
            exclusiveIds,
            previousChildIds,
            nextChildIds
          );
          if (splitNodes) { this.children.splice(i, 1, ...splitNodes); }
          var remainderToDelete = spliceOldEnd.traversalFrom(childEnd);
          childEnd = childStart.traverse(child.extent);
        }
      }

      if (!this.mergeChildrenIfNeeded(i - 1)) { i++; }
    }
    return this.splitIfNeeded();
  }

  getStart(id) {
    if (!this.ids.has(id)) { return; }
    let childEnd = Point.ZERO;
    for (let child of this.children) {
      let startRelativeToChild;
      let childStart = childEnd;
      childEnd = childStart.traverse(child.extent);
      if (startRelativeToChild = child.getStart(id)) {
        return childStart.traverse(startRelativeToChild);
      }
    }
  }

  getEnd(id) {
    if (!this.ids.has(id)) { return; }
    let childEnd = Point.ZERO;
    for (let child of this.children) {
      let endRelativeToChild;
      let childStart = childEnd;
      childEnd = childStart.traverse(child.extent);
      if (endRelativeToChild = child.getEnd(id)) {
        var end = childStart.traverse(endRelativeToChild);
      } else if (end != null) {
        break;
      }
    }
    return end;
  }

  dump(ids, offset, snapshot) {
    for (let child of this.children) {
      if ((!ids) || setsOverlap(ids, child.ids)) {
        offset = child.dump(ids, offset, snapshot);
      } else {
        offset = offset.traverse(child.extent);
      }
    }
    return offset;
  }

  findContaining(point, set) {
    let childEnd = Point.ZERO;
    for (let child of this.children) {
      let childStart = childEnd;
      childEnd = childStart.traverse(child.extent);
      if (childEnd.compare(point) < 0) { continue; }
      if (childStart.compare(point) > 0) { break; }
      child.findContaining(point.traversalFrom(childStart), set);
    }
  }

  findIntersecting(start, end, set) {
    if (start.isZero() && end.compare(this.extent) === 0) {
      addSet(set, this.ids);
      return;
    }

    let childEnd = Point.ZERO;
    for (let child of this.children) {
      let childStart = childEnd;
      childEnd = childStart.traverse(child.extent);
      if (childEnd.compare(start) < 0) { continue; }
      if (childStart.compare(end) > 0) { break; }
      child.findIntersecting(
        Point.max(Point.ZERO, start.traversalFrom(childStart)),
        Point.min(child.extent, end.traversalFrom(childStart)),
        set
      );
    }
  }

  findStartingAt(position, result, previousIds) {
    for (let child of this.children) {
      if (position.isNegative()) { break; }
      let nextPosition = position.traversalFrom(child.extent);
      if (!nextPosition.isPositive()) {
        child.findStartingAt(position, result, previousIds);
      }
      previousIds = child.ids;
      position = nextPosition;
    }
  }

  findEndingAt(position, result) {
    for (let child of this.children) {
      if (position.isNegative()) { break; }
      let nextPosition = position.traversalFrom(child.extent);
      if (!nextPosition.isPositive()) {
        child.findEndingAt(position, result);
      }
      position = nextPosition;
    }
  }

  hasEmptyRightmostLeaf() {
    return this.children[this.children.length - 1].hasEmptyRightmostLeaf();
  }

  hasEmptyLeftmostLeaf() {
    return this.children[0].hasEmptyLeftmostLeaf();
  }

  getLeftmostIds() {
    return this.children[0].getLeftmostIds();
  }

  getRightmostIds() {
    return last(this.children).getRightmostIds();
  }

  merge(other) {
    let childCount = this.children.length + other.children.length;
    if (childCount <= BRANCHING_THRESHOLD + 1) {
      if (last(this.children).merge(other.children[0])) {
        other.children.shift();
        childCount--;
      }

      if (childCount <= BRANCHING_THRESHOLD) {
        this.extent = this.extent.traverse(other.extent);
        addSet(this.ids, other.ids);
        this.children.push(...other.children);
        return true;
      }
    }
    return false;
  }

  splitIfNeeded() {
    let branchingRatio;
    if ((branchingRatio = this.children.length / BRANCHING_THRESHOLD) > 1) {
      let splitIndex = Math.ceil(branchingRatio);
      return [new Node(this.children.slice(0, splitIndex)), new Node(this.children.slice(splitIndex))];
    }
  }

  mergeChildrenIfNeeded(i) {
    if (__guard__(this.children[i], x => x.merge(this.children[i + 1]))) {
      this.children.splice(i + 1, 1);
      return true;
    } else {
      return false;
    }
  }

  toString(indentLevel=0) {
    let next;
    let indent = "";
    let iterable = __range__(0, indentLevel, false);
    for (let j = 0; j < iterable.length; j++) { let i = iterable[j]; indent += " "; }

    let ids = [];
    let values = this.ids.values();
    while (!(next = values.next()).done) {
      ids.push(next.value);
    }

    return indent + "Node " + this.extent + " (" + (ids.join(" ")) + ")\n" + (this.children.map(c => c.toString(indentLevel + 2)).join("\n"));
  }
}

class Leaf {
  constructor(extent, ids) {
    this.extent = extent;
    this.ids = ids;
  }

  insert(ids, start, end) {
    // If the given range matches the start and end of this leaf exactly, add
    // the given id to this leaf. Otherwise, split this leaf into up to 3 leaves,
    // adding the id to the portion of this leaf that intersects the given range.
    if (start.isZero() && end.compare(this.extent) === 0) {
      addSet(this.ids, ids);
      return;
    } else {
      let newIds = new Set(this.ids);
      addSet(newIds, ids);
      let newLeaves = [];
      if (start.isPositive()) { newLeaves.push(new Leaf(start, new Set(this.ids))); }
      newLeaves.push(new Leaf(end.traversalFrom(start), newIds));
      if (this.extent.compare(end) > 0) { newLeaves.push(new Leaf(this.extent.traversalFrom(end), new Set(this.ids))); }
      return newLeaves;
    }
  }

  delete(id) {
    return this.ids.delete(id);
  }

  splice(position, spliceOldExtent, spliceNewExtent, exclusiveIds, precedingIds, followingIds) {
    if (position.isZero() && spliceOldExtent.isZero()) {

      let leftIds = new Set(precedingIds);
      addSet(leftIds, this.ids);
      subtractSet(leftIds, exclusiveIds);

      if (this.extent.isZero()) {
        precedingIds.forEach(id => {
          if (!followingIds.has(id)) { return this.ids.delete(id); }
        }
        );
      }

      return [new Leaf(spliceNewExtent, leftIds), this];
    } else {
      let spliceOldEnd = position.traverse(spliceOldExtent);
      let spliceNewEnd = position.traverse(spliceNewExtent);
      let extentAfterChange = this.extent.traversalFrom(spliceOldEnd);
      this.extent = spliceNewEnd.traverse(Point.max(Point.ZERO, extentAfterChange));
      return;
    }
  }

  getStart(id) {
    if (this.ids.has(id)) { return Point.ZERO; }
  }

  getEnd(id) {
    if (this.ids.has(id)) { return this.extent; }
  }

  dump(ids, offset, snapshot) {
    let next;
    let end = offset.traverse(this.extent);
    let values = this.ids.values();
    while (!(next = values.next()).done) {
      let id = next.value;
      if ((!ids) || ids.has(id)) {
        if (snapshot[id] == null) { snapshot[id] = templateRange(); }
        if (snapshot[id].start == null) { snapshot[id].start = offset; }
        snapshot[id].end = end;
      }
    }
    return end;
  }

  findEndingAt(position, result) {
    if (position.isEqual(this.extent)) {
      addSet(result, this.ids);
    } else if (position.isZero()) {
      subtractSet(result, this.ids);
    }
  }

  findStartingAt(position, result, previousIds) {
    if (position.isZero()) {
      this.ids.forEach(function(id) {
        if (!previousIds.has(id)) { return result.add(id); }
      });
    }
  }

  findContaining(point, set) {
    return addSet(set, this.ids);
  }

  findIntersecting(start, end, set) {
    return addSet(set, this.ids);
  }

  hasEmptyRightmostLeaf() {
    return this.extent.isZero();
  }

  hasEmptyLeftmostLeaf() {
    return this.extent.isZero();
  }

  getLeftmostIds() {
    return this.ids;
  }

  getRightmostIds() {
    return this.ids;
  }

  merge(other) {
    if (setEqual(this.ids, other.ids) || (this.extent.isZero() && other.extent.isZero())) {
      this.extent = this.extent.traverse(other.extent);
      addSet(this.ids, other.ids);
      return true;
    } else {
      return false;
    }
  }

  toString(indentLevel=0) {
    let next;
    let indent = "";
    let iterable = __range__(0, indentLevel, false);
    for (let j = 0; j < iterable.length; j++) { let i = iterable[j]; indent += " "; }

    let ids = [];
    let values = this.ids.values();
    while (!(next = values.next()).done) {
      ids.push(next.value);
    }

    return `${indent}Leaf ${this.extent} (${ids.join(" ")})`;
  }
}

class MarkerIndex {
  constructor() {
    this.clear();
  }

  insert(id, start, end) {
    let splitNodes;
    assertValidId(id);
    this.rangeCache[id] = new Range(start, end);
    if (splitNodes = this.rootNode.insert(new Set().add(id + ""), start, end)) {
      return this.rootNode = new Node(splitNodes);
    }
  }

  delete(id) {
    assertValidId(id);
    delete this.rangeCache[id];
    this.rootNode.delete(id);
    return this.condenseIfNeeded();
  }

  splice(position, oldExtent, newExtent) {
    let splitNodes;
    this.clearRangeCache();
    if (splitNodes = this.rootNode.splice(position, oldExtent, newExtent, this.exclusiveIds, new Set, new Set)) {
      this.rootNode = new Node(splitNodes);
    }
    this.condenseIfNeeded();

    // vjeux: changed
    return { touch: [] };
  }

  isExclusive(id) {
    return this.exclusiveIds.has(id);
  }

  setExclusive(id, isExclusive) {
    assertValidId(id);
    if (isExclusive) {
      return this.exclusiveIds.add(id);
    } else {
      return this.exclusiveIds.delete(id);
    }
  }

  getRange(id) {
    let start;
    if (start = this.getStart(id)) {
      return new Range(start, this.getEnd(id));
    }
  }

  getStart(id) {
    if (!this.rootNode.ids.has(id)) { return; }

    let entry = this.rangeCache[id] != null ? this.rangeCache[id] : (this.rangeCache[id] = templateRange());
    return entry.start != null ? entry.start : (entry.start = this.rootNode.getStart(id));
  }

  getEnd(id) {
    if (!this.rootNode.ids.has(id)) { return; }

    let entry = this.rangeCache[id] != null ? this.rangeCache[id] : (this.rangeCache[id] = templateRange());
    return entry.end != null ? entry.end : (entry.end = this.rootNode.getEnd(id));
  }

  findContaining(start, end) {
    let containing = new Set;
    this.rootNode.findContaining(start, containing);
    if ((end != null) && end.compare(start) !== 0) {
      let containingEnd = new Set;
      this.rootNode.findContaining(end, containingEnd);
      containing.forEach(function(id) { if (!containingEnd.has(id)) { return containing.delete(id); } });
    }
    return containing;
  }

  findContainedIn(start, end = start) {
    let result = this.findStartingIn(start, end);
    subtractSet(result, this.findIntersecting(end.traverse(Point(0, 1))));
    return result;
  }

  findIntersecting(start, end = start) {
    let intersecting = new Set;
    this.rootNode.findIntersecting(start, end, intersecting);
    return intersecting;
  }

  findStartingIn(start, end) {
    if (end != null) {
      var result = this.findIntersecting(start, end);
      if (start.isPositive()) {
        if (start.column === 0) {
          var previousPoint = Point(start.row - 1, Infinity);
        } else {
          var previousPoint = Point(start.row, start.column - 1);
        }
        subtractSet(result, this.findIntersecting(previousPoint));
      }
      return result;
    } else {
      var result = new Set;
      this.rootNode.findStartingAt(start, result, new Set);
      return result;
    }
  }

  findEndingIn(start, end) {
    if (end != null) {
      var result = this.findIntersecting(start, end);
      subtractSet(result, this.findIntersecting(end.traverse(Point(0, 1))));
      return result;
    } else {
      var result = new Set;
      this.rootNode.findEndingAt(start, result);
      return result;
    }
  }

  clear() {
    this.rootNode = new Leaf(Point.INFINITY, new Set);
    this.exclusiveIds = new Set;
    return this.clearRangeCache();
  }

  dump(ids) {
    let result = {};
    this.rootNode.dump(ids, Point.ZERO, result);
    extend(this.rangeCache, result);
    return result;
  }

  /*
  Section: Private
  */

  clearRangeCache() {
    return this.rangeCache = {};
  }

  condenseIfNeeded() {
    while (__guard__(this.rootNode.children, x => x.length) === 1) {
      this.rootNode = this.rootNode.children[0];
    }
  }
};

var assertValidId = function(id) {
  // Original:
  // if (typeof id !== 'string') {
  //   throw new TypeError("Marker ID must be a string");
  // }

  // It seems that marker ids are no longer required to be strings.
  // In practice, they appear to be numbers because that is what
  // TextBuffer.getNextMarkerId() vends out.
  const type = typeof id;
  if (type !== 'string' && type !== 'number') {
    throw new TypeError("Marker ID must be a string or number");
  }
};

var templateRange = () => Object.create(Range.prototype);

var setsOverlap = function(set1, set2) {
  let next;
  let values = set1.values();
  while (!(next = values.next()).done) {
    if (set2.has(next.value)) { return true; }
  }
  return false;
};

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
function __range__(left, right, inclusive) {
  let range = [];
  let ascending = left < right;
  let end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}

module.exports = MarkerIndex;
