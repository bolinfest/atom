Point = require "./point"
Range = require "./range"
{last, extend} = require "underscore-plus"
{addSet, subtractSet, intersectSet, setEqual} = require "./set-helpers"

BRANCHING_THRESHOLD = 3

class Node
  constructor: (@children) ->
    @ids = new Set
    @extent = Point.ZERO
    for child in @children
      @extent = @extent.traverse(child.extent)
      addSet(@ids, child.ids)

  insert: (ids, start, end) ->
    rangeIsEmpty = start.compare(end) is 0
    childEnd = Point.ZERO
    i = 0
    while i < @children.length
      child = @children[i++]
      childStart = childEnd
      childEnd = childStart.traverse(child.extent)

      switch childEnd.compare(start)
        when -1 then childPrecedesRange = true
        when 1  then childPrecedesRange = false
        when 0
          if child.hasEmptyRightmostLeaf()
            childPrecedesRange = false
          else
            childPrecedesRange = true
            if rangeIsEmpty
              ids = new Set(ids)
              child.findContaining(child.extent, ids)
      continue if childPrecedesRange

      switch childStart.compare(end)
        when -1 then childFollowsRange = false
        when 1  then childFollowsRange = true
        when 0  then childFollowsRange = not (child.hasEmptyLeftmostLeaf() or rangeIsEmpty)
      break if childFollowsRange

      relativeStart = Point.max(Point.ZERO, start.traversalFrom(childStart))
      relativeEnd = Point.min(child.extent, end.traversalFrom(childStart))
      if newChildren = child.insert(ids, relativeStart, relativeEnd)
        @children.splice(i - 1, 1, newChildren...)
        i += newChildren.length - 1
      break if rangeIsEmpty

    if newNodes = @splitIfNeeded()
      newNodes
    else
      addSet(@ids, ids)
      return

  delete: (id) ->
    return unless @ids.delete(id)
    i = 0
    while i < @children.length
      @children[i].delete(id)
      i++ unless @mergeChildrenIfNeeded(i - 1)

  splice: (position, oldExtent, newExtent, exclusiveIds, precedingIds, followingIds) ->
    oldRangeIsEmpty = oldExtent.isZero()
    spliceOldEnd = position.traverse(oldExtent)
    spliceNewEnd = position.traverse(newExtent)
    extentAfterChange = @extent.traversalFrom(spliceOldEnd)
    @extent = spliceNewEnd.traverse(Point.max(Point.ZERO, extentAfterChange))

    if position.isZero() and oldRangeIsEmpty
      precedingIds?.forEach (id) =>
        unless exclusiveIds.has(id)
          @ids.add(id)

    i = 0
    childEnd = Point.ZERO
    while i < @children.length
      child = @children[i]
      childStart = childEnd
      childEnd = childStart.traverse(child.extent)

      switch childEnd.compare(position)
        when -1 then childPrecedesRange = true
        when 0  then childPrecedesRange = not (child.hasEmptyRightmostLeaf() and oldRangeIsEmpty)
        when 1  then childPrecedesRange = false

      unless childPrecedesRange
        if remainderToDelete?
          if remainderToDelete.isPositive()
            previousExtent = child.extent
            child.splice(Point.ZERO, remainderToDelete, Point.ZERO)
            remainderToDelete = remainderToDelete.traversalFrom(previousExtent)
            childEnd = childStart.traverse(child.extent)
        else
          if oldRangeIsEmpty
            previousChildIds = @children[i - 1]?.getRightmostIds() ? precedingIds
            nextChildIds = @children[i + 1]?.getLeftmostIds() ? followingIds
          splitNodes = child.splice(
            position.traversalFrom(childStart),
            oldExtent,
            newExtent,
            exclusiveIds,
            previousChildIds,
            nextChildIds
          )
          @children.splice(i, 1, splitNodes...) if splitNodes
          remainderToDelete = spliceOldEnd.traversalFrom(childEnd)
          childEnd = childStart.traverse(child.extent)

      i++ unless @mergeChildrenIfNeeded(i - 1)
    @splitIfNeeded()

  getStart: (id) ->
    return unless @ids.has(id)
    childEnd = Point.ZERO
    for child in @children
      childStart = childEnd
      childEnd = childStart.traverse(child.extent)
      if startRelativeToChild = child.getStart(id)
        return childStart.traverse(startRelativeToChild)
    return

  getEnd: (id) ->
    return unless @ids.has(id)
    childEnd = Point.ZERO
    for child in @children
      childStart = childEnd
      childEnd = childStart.traverse(child.extent)
      if endRelativeToChild = child.getEnd(id)
        end = childStart.traverse(endRelativeToChild)
      else if end?
        break
    end

  dump: (ids, offset, snapshot) ->
    for child in @children
      if (not ids) or setsOverlap(ids, child.ids)
        offset = child.dump(ids, offset, snapshot)
      else
        offset = offset.traverse(child.extent)
    offset

  findContaining: (point, set) ->
    childEnd = Point.ZERO
    for child in @children
      childStart = childEnd
      childEnd = childStart.traverse(child.extent)
      continue if childEnd.compare(point) < 0
      break if childStart.compare(point) > 0
      child.findContaining(point.traversalFrom(childStart), set)
    return

  findIntersecting: (start, end, set) ->
    if start.isZero() and end.compare(@extent) is 0
      addSet(set, @ids)
      return

    childEnd = Point.ZERO
    for child in @children
      childStart = childEnd
      childEnd = childStart.traverse(child.extent)
      continue if childEnd.compare(start) < 0
      break if childStart.compare(end) > 0
      child.findIntersecting(
        Point.max(Point.ZERO, start.traversalFrom(childStart)),
        Point.min(child.extent, end.traversalFrom(childStart)),
        set
      )
    return

  findStartingAt: (position, result, previousIds) ->
    for child in @children
      break if position.isNegative()
      nextPosition = position.traversalFrom(child.extent)
      unless nextPosition.isPositive()
        child.findStartingAt(position, result, previousIds)
      previousIds = child.ids
      position = nextPosition
    return

  findEndingAt: (position, result) ->
    for child in @children
      break if position.isNegative()
      nextPosition = position.traversalFrom(child.extent)
      unless nextPosition.isPositive()
        child.findEndingAt(position, result)
      position = nextPosition
    return

  hasEmptyRightmostLeaf: ->
    @children[@children.length - 1].hasEmptyRightmostLeaf()

  hasEmptyLeftmostLeaf: ->
    @children[0].hasEmptyLeftmostLeaf()

  getLeftmostIds: ->
    @children[0].getLeftmostIds()

  getRightmostIds: ->
    last(@children).getRightmostIds()

  merge: (other) ->
    childCount = @children.length + other.children.length
    if childCount <= BRANCHING_THRESHOLD + 1
      if last(@children).merge(other.children[0])
        other.children.shift()
        childCount--

      if childCount <= BRANCHING_THRESHOLD
        @extent = @extent.traverse(other.extent)
        addSet(@ids, other.ids)
        @children.push(other.children...)
        return true
    false

  splitIfNeeded: ->
    if (branchingRatio = @children.length / BRANCHING_THRESHOLD) > 1
      splitIndex = Math.ceil(branchingRatio)
      [new Node(@children.slice(0, splitIndex)), new Node(@children.slice(splitIndex))]

  mergeChildrenIfNeeded: (i) ->
    if @children[i]?.merge(@children[i + 1])
      @children.splice(i + 1, 1)
      true
    else
      false

  toString: (indentLevel=0) ->
    indent = ""
    indent += " " for i in [0...indentLevel] by 1

    ids = []
    values = @ids.values()
    until (next = values.next()).done
      ids.push(next.value)

    """
      #{indent}Node #{@extent} (#{ids.join(" ")})
      #{@children.map((c) -> c.toString(indentLevel + 2)).join("\n")}
    """

class Leaf
  constructor: (@extent, @ids) ->

  insert: (ids, start, end) ->
    # If the given range matches the start and end of this leaf exactly, add
    # the given id to this leaf. Otherwise, split this leaf into up to 3 leaves,
    # adding the id to the portion of this leaf that intersects the given range.
    if start.isZero() and end.compare(@extent) is 0
      addSet(@ids, ids)
      return
    else
      newIds = new Set(@ids)
      addSet(newIds, ids)
      newLeaves = []
      newLeaves.push(new Leaf(start, new Set(@ids))) if start.isPositive()
      newLeaves.push(new Leaf(end.traversalFrom(start), newIds))
      newLeaves.push(new Leaf(@extent.traversalFrom(end), new Set(@ids))) if @extent.compare(end) > 0
      newLeaves

  delete: (id) ->
    @ids.delete(id)

  splice: (position, spliceOldExtent, spliceNewExtent, exclusiveIds, precedingIds, followingIds) ->
    if position.isZero() and spliceOldExtent.isZero()

      leftIds = new Set(precedingIds)
      addSet(leftIds, @ids)
      subtractSet(leftIds, exclusiveIds)

      if @extent.isZero()
        precedingIds.forEach (id) =>
          @ids.delete(id) unless followingIds.has(id)

      [new Leaf(spliceNewExtent, leftIds), this]
    else
      spliceOldEnd = position.traverse(spliceOldExtent)
      spliceNewEnd = position.traverse(spliceNewExtent)
      extentAfterChange = @extent.traversalFrom(spliceOldEnd)
      @extent = spliceNewEnd.traverse(Point.max(Point.ZERO, extentAfterChange))
      return

  getStart: (id) ->
    Point.ZERO if @ids.has(id)

  getEnd: (id) ->
    @extent if @ids.has(id)

  dump: (ids, offset, snapshot) ->
    end = offset.traverse(@extent)
    values = @ids.values()
    until (next = values.next()).done
      id = next.value
      if (not ids) or ids.has(id)
        snapshot[id] ?= templateRange()
        snapshot[id].start ?= offset
        snapshot[id].end = end
    end

  findEndingAt: (position, result) ->
    if position.isEqual(@extent)
      addSet(result, @ids)
    else if position.isZero()
      subtractSet(result, @ids)
    return

  findStartingAt: (position, result, previousIds) ->
    if position.isZero()
      @ids.forEach (id) ->
        result.add(id) unless previousIds.has(id)
    return

  findContaining: (point, set) ->
    addSet(set, @ids)

  findIntersecting: (start, end, set) ->
    addSet(set, @ids)

  hasEmptyRightmostLeaf: ->
    @extent.isZero()

  hasEmptyLeftmostLeaf: ->
    @extent.isZero()

  getLeftmostIds: ->
    @ids

  getRightmostIds: ->
    @ids

  merge: (other) ->
    if setEqual(@ids, other.ids) or @extent.isZero() and other.extent.isZero()
      @extent = @extent.traverse(other.extent)
      addSet(@ids, other.ids)
      true
    else
      false

  toString: (indentLevel=0) ->
    indent = ""
    indent += " " for i in [0...indentLevel] by 1

    ids = []
    values = @ids.values()
    until (next = values.next()).done
      ids.push(next.value)

    "#{indent}Leaf #{@extent} (#{ids.join(" ")})"

module.exports =
class MarkerIndex
  constructor: ->
    @clear()

  insert: (id, start, end) ->
    assertValidId(id)
    @rangeCache[id] = Range(start, end)
    if splitNodes = @rootNode.insert(new Set().add(id + ""), start, end)
      @rootNode = new Node(splitNodes)

  delete: (id) ->
    assertValidId(id)
    delete @rangeCache[id]
    @rootNode.delete(id)
    @condenseIfNeeded()

  splice: (position, oldExtent, newExtent) ->
    @clearRangeCache()
    if splitNodes = @rootNode.splice(position, oldExtent, newExtent, @exclusiveIds, new Set, new Set)
      @rootNode = new Node(splitNodes)
    @condenseIfNeeded()

  isExclusive: (id) ->
    @exclusiveIds.has(id)

  setExclusive: (id, isExclusive) ->
    assertValidId(id)
    if isExclusive
      @exclusiveIds.add(id)
    else
      @exclusiveIds.delete(id)

  getRange: (id) ->
    if start = @getStart(id)
      Range(start, @getEnd(id))

  getStart: (id) ->
    return unless @rootNode.ids.has(id)

    entry = @rangeCache[id] ?= templateRange()
    entry.start ?= @rootNode.getStart(id)

  getEnd: (id) ->
    return unless @rootNode.ids.has(id)

    entry = @rangeCache[id] ?= templateRange()
    entry.end ?= @rootNode.getEnd(id)

  findContaining: (start, end) ->
    containing = new Set
    @rootNode.findContaining(start, containing)
    if end? and end.compare(start) isnt 0
      containingEnd = new Set
      @rootNode.findContaining(end, containingEnd)
      containing.forEach (id) -> containing.delete(id) unless containingEnd.has(id)
    containing

  findContainedIn: (start, end = start) ->
    result = @findStartingIn(start, end)
    subtractSet(result, @findIntersecting(end.traverse(Point(0, 1))))
    result

  findIntersecting: (start, end = start) ->
    intersecting = new Set
    @rootNode.findIntersecting(start, end, intersecting)
    intersecting

  findStartingIn: (start, end) ->
    if end?
      result = @findIntersecting(start, end)
      if start.isPositive()
        if start.column is 0
          previousPoint = Point(start.row - 1, Infinity)
        else
          previousPoint = Point(start.row, start.column - 1)
        subtractSet(result, @findIntersecting(previousPoint))
      result
    else
      result = new Set
      @rootNode.findStartingAt(start, result, new Set)
      result

  findEndingIn: (start, end) ->
    if end?
      result = @findIntersecting(start, end)
      subtractSet(result, @findIntersecting(end.traverse(Point(0, 1))))
      result
    else
      result = new Set
      @rootNode.findEndingAt(start, result)
      result

  clear: ->
    @rootNode = new Leaf(Point.INFINITY, new Set)
    @exclusiveIds = new Set
    @clearRangeCache()

  dump: (ids) ->
    result = {}
    @rootNode.dump(ids, Point.ZERO, result)
    extend(@rangeCache, result)
    result

  ###
  Section: Private
  ###

  clearRangeCache: ->
    @rangeCache = {}

  condenseIfNeeded: ->
    while @rootNode.children?.length is 1
      @rootNode = @rootNode.children[0]
    return

assertValidId = (id) ->
  unless typeof id is 'string'
    throw new TypeError("Marker ID must be a string")

templateRange = ->
  Object.create(Range.prototype)

setsOverlap = (set1, set2) ->
  values = set1.values()
  until (next = values.next()).done
    return true if set2.has(next.value)
  return false
