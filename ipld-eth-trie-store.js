const IpldDown = require('./ipld-down')
const cidForHash = require('ipld-eth-trie/src/common').cidForHash

module.exports = IpldEthTrieStore

function IpldEthTrieStore(opts){
  const self = this
  self._blockService = opts.blockService
  self._codec = opts.codec
  self._leafCodec = opts.leafCodec
  if (!self._blockService) throw new Error('No blockService')
  if (!self._codec) throw new Error('No codec')
  if (!self._leafCodec) throw new Error('No leafCodec')
  self._nodeDb = new IpldDown({ codec: self._codec, blockService: self._blockService })
}

IpldEthTrieStore.prototype.put = function(trie, cb){
  const self = this
  trie._findDbNodes(function (root, node, key, next) {
    self._nodeDb.put(root, node.serialize(), {
      keyEncoding: 'binary',
      valueEncoding: 'binary',
    }, next)
  }, (err) => {
    if (err) return cb(err)
    let rootCid = cidForHash(self._codec, trie.root)
    cb(null, rootCid)
  })
}

IpldEthTrieStore.prototype.get = function(treeRoot, cb){
  const self = this
  console.warn('IpldEthTrieStore.get!')
}
