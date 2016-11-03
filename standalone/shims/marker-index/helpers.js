let SpliceArrayChunkSize = 100000;

module.exports = {
  spliceArray(originalArray, start, length, insertedArray=[]) {
    if (insertedArray.length < SpliceArrayChunkSize) {
      return originalArray.splice(start, length, ...insertedArray);
    } else {
      let removedValues = originalArray.splice(start, length);
      let iterable = __range__(0, insertedArray.length, true);
      for (let i = 0, step = SpliceArrayChunkSize; i < iterable.length; i += step) {
        let chunkStart = iterable[i];
        let chunkEnd = chunkStart + SpliceArrayChunkSize;
        let chunk = insertedArray.slice(chunkStart, chunkEnd);
        originalArray.splice(start + chunkStart, 0, ...chunk);
      }
      return removedValues;
    }
  },

  newlineRegex: /\r\n|\n|\r/g
};

function __range__(left, right, inclusive) {
  let range = [];
  let ascending = left < right;
  let end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}
