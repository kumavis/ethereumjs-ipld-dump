const util = require('util')
const async = require('async')
const AbstractLevelDown = require('abstract-leveldown').AbstractLevelDOWN
const RLP = require('rlp')
const EthBlock = require('ethereumjs-block')
const EthBlockHead = require('ethereumjs-block/header')
const IpfsBlock = require('ipfs-block')
const IpldEthStateTrieResolver = require('ipld-eth-state-trie')
const cidForHash = require('ipld-eth-trie/src/common').cidForHash
const IpldDown = require('./ipld-down')
const IpldEthTrieStore = require('./ipld-eth-trie-store')

module.exports = IpldEthBlockDown

function IpldEthBlockDown(opts){
  const self = this
  AbstractLevelDown.call(self, '')
  let blockService = self._blockService = opts.blockService
  if (!self._blockService) throw new Error('No blockService')
  self._blockDb = new IpldDown({ codec: 'eth-block', blockService })
  self._ommerDb = new IpldDown({ codec: 'eth-block-list', blockService })
  self._txTrieStore = new IpldEthTrieStore({ codec: 'eth-tx-trie', leafCodec: 'eth-tx', blockService })
}

// our new prototype inherits from AbstractLevelDown
util.inherits(IpldEthBlockDown, AbstractLevelDown)

IpldEthBlockDown.prototype._put = function(key, value, opts, cb){
  const self = this
  let blockHash = key
  let ethBlock = new EthBlock(value)
  let ethHeader = ethBlock.header
  let ommerBlob = RLP.encode(ethBlock.uncleHeaders.map(header => header.raw))
  async.parallel([
    (cb) => self._blockDb.put(blockHash, ethHeader.serialize(), opts, cb),
    (cb) => self._ommerDb.put(ethHeader.uncleHash, ommerBlob, opts, cb),
    (cb) => ethBlock.genTxTrie((err) => {
      if (err) return cb(err)
      self._txTrieStore.put(ethBlock.txTrie, cb)
    }),
  ], (err, results) => {
    if (err) return cb(err)
    // log dump
    let blockCid = results[0]
    console.log('blockCid:', blockCid.toBaseEncodedString())
    let ommerCid = results[1]
    console.log('ommerCid:', ommerCid.toBaseEncodedString())
    let txTrieCid = results[2]
    console.log('txTrieCid:', txTrieCid.toBaseEncodedString())
    cb()
  })
}

IpldEthBlockDown.prototype._get = function(key, opts, cb){
  const self = this
  self._blockDb.get(key, (err, rawBlockHeader) => {
    if (err) return cb(err)
    let ethHeader = new EthBlockHead(RLP.decode(rawBlockHeader))
    async.parallel([
      (cb) => self._ommerDb.get(ethHeader.uncleHash, { keyEncoding: 'binary' }, cb),
      // (cb) => self._txDb.get(ethHeader.uncleHash, cb),
    ], (err, results) => {
      if (err) return cb(err)
      let rawUncleHeaders = RLP.decode(results[0])
      let rawTransactions = []
      let ethBlock = new EthBlock({
        header: ethHeader.raw,
        uncleHeaders: rawUncleHeaders,
        transactions: rawTransactions,
      })
      cb(null, ethBlock.serialize())
    })
  })
}

IpldEthBlockDown.prototype._batch = function(ops, opts, cb){
  const self = this
  async.each(ops, (op, cb) => {
    if (op.type !== 'put') return cb(new Error('Unsupported batch op type', op.type))
    self._put(op.key, op.value, opts, cb)
  }, cb)
}
