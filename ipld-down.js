const util = require('util')
const async = require('async')
const AbstractLevelDown = require('abstract-leveldown').AbstractLevelDOWN
const IpfsBlock = require('ipfs-block')
const IpldEthStateTrieResolver = require('ipld-eth-state-trie')
const cidForHash = require('ipld-eth-trie/src/common').cidForHash

module.exports = IpldDown

function IpldDown(opts){
  const self = this
  AbstractLevelDown.call(self, '')
  self._blockService = opts.blockService
  self._codec = opts.codec
  if (!self._blockService) throw new Error('No blockService')
  if (!self._codec) throw new Error('No codec')
}

// our new prototype inherits from AbstractLevelDown
util.inherits(IpldDown, AbstractLevelDown)

IpldDown.prototype._put = function(key, value, opts, cb){
  const self = this
  let ipldObj = new IpfsBlock(value)
  let cid = cidForHash(self._codec, key)
  self._blockService.put({ block: ipldObj, cid: cid }, cb)
}

IpldDown.prototype._get = function(key, opts, cb){
  const self = this
  let cid = cidForHash(self._codec, key)
  async.waterfall([
    (cb) => self._blockService.get(cid, cb),
    (ipldBlock, cb) => cb(null, ipldBlock.data),
  ], cb)
}

IpldDown.prototype._batch = function(ops, opts, cb){
  const self = this
  async.each(ops, (op, cb) => {
    if (op.type !== 'put') return cb(new Error('Unsupported batch op type', op.type))
    self._put(op.key, op.value, opts, cb)
  }, cb)
}
