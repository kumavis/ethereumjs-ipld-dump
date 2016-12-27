const util = require('util')
const async = require('async')
const AbstractLevelDown = require('abstract-leveldown').AbstractLevelDOWN
const IpfsBlock = require('ipfs-block')
const IpldEthStateTrieResolver = require('ipld-eth-state-trie')
const cidForHash = require('ipld-eth-trie/src/common').cidForHash

module.exports = IpldDown

function IpldDown(opts){
  AbstractLevelDown.call(this, '')
  this._blockService = opts.blockService
}

// our new prototype inherits from AbstractLevelDown
util.inherits(IpldDown, AbstractLevelDown)

IpldDown.prototype._put = function(key, value, opts, cb){
  let ipldObj = new IpfsBlock(value)
  let cid = cidForHash('eth-state-trie', key)
  // console.log('put:', key.toString('hex').slice(0,4), '<-', value)
  this._blockService.put({ block: ipldObj, cid: cid }, cb)
}

IpldDown.prototype._get = function(key, opts, cb){
  const self = this
  let cid = cidForHash('eth-state-trie', key)
  // console.log('get:', key.toString('hex').slice(0,4))
  // self._blockService.get(cid, (err, result) => {
    // console.log('get:', key.toString('hex').slice(0,4), '->', result)
  //   cb(err, result)
  //   // console.log('ipldDown.get', err, result)
  // })
  async.waterfall([
    (cb) => self._blockService.get(cid, cb),
    (ipldBlock, cb) => {
      // console.log('ipldBlock.data:', ipldBlock.data)
      cb(null, ipldBlock.data)
    },
  // ], (err, result) => {
    // console.log('get:', key.toString('hex').slice(0,4), '->', result)
    // cb(err, result)
    // console.log('ipldDown.get', err, result)
  // })
  ], cb)
}

IpldDown.prototype._batch = function(ops, opts, cb){
  const self = this
  async.each(ops, (op, cb) => {
    if (op.type !== 'put') return cb(new Error('Unsupported batch op type', op.type))
    self._put(op.key, op.value, opts, cb)
  }, cb)
}
