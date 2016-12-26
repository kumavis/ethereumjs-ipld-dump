const pathUtil = require('path')
const async = require('async')
const createVm = require('ethereumjs-rpc-sync')
const onStreamEnd = require('end-of-stream')
const IpfsRepo = require('ipfs-repo')
const IpfsRepoStore = require('fs-pull-blob-store')
const BlockService = require('ipfs-block-service')
const IpfsBlock = require('ipfs-block')
const IpldBlockResolver = require('ipld-eth-block')
const EthTrieNode = require('merkle-patricia-tree/trieNode')
const IpldEthStateTrieResolver = require('js-ipld-eth-state-trie')


// let repoPath = pathUtil.resolve('./ipfs')
let repoPath = pathUtil.join(process.env.HOME, '/.jsipfs')
let ipfsRepo = new IpfsRepo(repoPath, { stores: IpfsRepoStore })
let blockService = new BlockService(ipfsRepo)
let startBlockNumber = process.argv[2] ? parseInt(process.argv[2]) : 0
let vm = createVm({ startBlock: startBlockNumber })

// stat counting
let redundantNodes = 0
let totalNodes = 0

// current block tracking
let lastBlock
vm.on('beforeBlock', function (block) {
  lastBlock = block
  redundantNodes = 0
  totalNodes = 0
})
vm.on('afterBlock', function (results, done) {
  // console.log('dump block:', lastBlock.header)
  async.parallel([
    // put block
    (cb) => putBlock(lastBlock.header, cb),
    // put uncles
    // - skip -
    // put txTrie
    // - skip -
    // put txReceiptTrie
    // - skip -
    // put stateTrie
    (cb) => putStateTrie(vm.stateManager.trie, cb),
    // put updated storageTrie
    // (cb) => async.each(updatedAccounts, putAccountStorageTrie, cb),
  // ], done)
  ], (err, results) => {
    if (err) throw err
    let blockCid = results[0]
    console.log('blockCid:', blockCid.toBaseEncodedString())
    done()
  })
})

function putBlock(ethBlock, cb){
  let ipldObj = new IpfsBlock(ethBlock.serialize())
  IpldBlockResolver.util.cid(ethBlock, (err, cid) => {
    blockService.put({ block: ipldObj, cid: cid }, (err) => {
      if (err) return cb(err)
      cb(null, cid)
    })
  })
}

function putStateTrie(trie, cb){
  let fullNodes = []
  dumpTrieFullNodes(trie, fullNodes, (err) => {
    async.eachLimit(fullNodes, 256, putStateTrieNode, function(){
      console.log('redundantNodes:', redundantNodes)
      console.log('totalNodes:', totalNodes)
      console.log('newNodes:', totalNodes-redundantNodes)
      cb.apply(null, arguments)
    })
  })
}

function putStateTrieNode(trieNode, cb){
  let ipldObj = new IpfsBlock(trieNode.serialize())
  IpldEthStateTrieResolver.util.cid(trieNode, (err, cid) => {
    // blockService.put({ block: ipldObj, cid: cid }, cb)
    
    async.waterfall([
      (next) => blockService.get(cid, (err, result) => next(null, result)),
      (block,next) => {
        totalNodes++
        if (block) redundantNodes++
        next()
      },
      (next) => blockService.put({ block: ipldObj, cid: cid }, next),
    ], cb)
  })
}

function putAccountStorageTrie(account, cb){

}

// util

function dumpTrieFullNodes(trie, fullNodes, cb){
  let inlineNodes = []
  trie._walkTrie(trie.root, (root, node, key, walkController) => {
    // skip inline nodes
    if (contains(inlineNodes, node.raw)) return walkController.next()
    fullNodes.push(node)
    // check children for inline nodes
    node.getChildren().forEach((child) => {
      let value = child[1]
      if (EthTrieNode.isRawNode(value)) {
        inlineNodes.push(value)
      }
    })
    // continue
    walkController.next()
  }, cb)
}

function contains(array, item) {
  return array.indexOf(item) !== -1
}