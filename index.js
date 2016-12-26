const pathUtil = require('path')
const async = require('async')
const onStreamEnd = require('end-of-stream')
const leveldb = require('level')
const ethUtil = require('ethereumjs-util')
const VM = require('ethereumjs-vm')
const Blockchain = require('ethereumjs-blockchain')
const syncVm = require('ethereumjs-rpc-sync')
const EthSecureTrie = require('merkle-patricia-tree/secure.js')
const EthTrieNode = require('merkle-patricia-tree/trieNode')
const IpfsRepo = require('ipfs-repo')
const IpfsRepoStore = require('fs-pull-blob-store')
const BlockService = require('ipfs-block-service')
const IpfsBlock = require('ipfs-block')
const IpldBlockResolver = require('ipld-eth-block')
const IpldEthStateTrieResolver = require('js-ipld-eth-state-trie')


// let repoPath = pathUtil.resolve('./ipfs')
let repoPath = pathUtil.join(process.env.HOME, '/.jsipfs')
let ipfsRepo = new IpfsRepo(repoPath, { stores: IpfsRepoStore })
let blockService = new BlockService(ipfsRepo)
let headBlockNumber = process.argv[2] ? parseInt(process.argv[2]) : 0


var stateDb = leveldb('./stateDb')
var blockchainDb = leveldb('./blockchainDb')
var iteratorDb = leveldb('./iteratorDb')

var stateTrie = new EthSecureTrie(stateDb)
var blockchain = new Blockchain(blockchainDb, false)
var vm = new VM({
  blockchain: blockchain,
  state: stateTrie,
})

// stat counting
let redundantNodes = 0
let totalNodes = 0

// we track our own head
// based on blocks that have validated their state root
getHeadBlockNumber((err, startBlockNumber) => {
  if (err) throw err
  startBlockNumber = headBlockNumber !== undefined ? headBlockNumber : startBlockNumber
  console.log(`syncing from block #${startBlockNumber}`)

  syncVm(vm, { startBlock: startBlockNumber })
  setupStateRootChecking(vm)
  setupStateDumping(vm)
  setupHeadTracking(vm)
  setupLogging(vm)
})

function setupStateRootChecking(vm){
  let lastBlock
  vm.on('beforeBlock', function (block) {
    lastBlock = block
  })
  vm.on('afterBlock', function (results) {
    // if (results.error) console.log(results.error)
    var ourStateRoot = ethUtil.bufferToHex(vm.stateManager.trie.root)
    var stateRootMatches = (ourStateRoot === ethUtil.bufferToHex(lastBlock.header.stateRoot))
    if (!stateRootMatches) {
      throw new Error('Stateroots don\'t match.')
      process.exit()
    }
  })
}

// current block tracking
function setupStateDumping(vm){
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
}

function setupHeadTracking(vm){
  let lastBlock, blockNumber, blockHash
  vm.on('beforeBlock', function (block) {
    lastBlock = block
    blockNumber = ethUtil.bufferToInt(lastBlock.header.number)
    blockHash = ethUtil.bufferToHex(lastBlock.hash())
  })
  vm.on('afterBlock', function (results, done) {
    setHeadBlockNumber(blockNumber, done)
  })
}

// setup logging
function setupLogging(vm){
  let lastBlock, blockNumber, blockHash
  vm.on('beforeBlock', function (block) {
    lastBlock = block
    blockNumber = ethUtil.bufferToInt(lastBlock.header.number)
    blockHash = ethUtil.bufferToHex(lastBlock.hash())
  })
  vm.on('afterBlock', function (results) {
    // var out = `#${blockNumber} ${blockHash} txs: ${results.receipts.length} root: ${ourStateRoot}`
    var paddedBlockNumber = ('          ' + blockNumber).slice(-8)
    var out = `#${paddedBlockNumber} ${blockHash} txs: ${results.receipts.length}`
    console.log(out)
  })
}

// ipld state dumpers

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

function getHeadBlockNumber(cb){
  iteratorDb.get('head', function(err, result){
    if (err) return cb(null, 0)
    cb(null, parseInt(result))
  })
}

function setHeadBlockNumber(blockNumber, cb){
  iteratorDb.put('head', blockNumber, function(err){
    if (err) return cb(err)
    cb()
  })
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