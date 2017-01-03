const pathUtil = require('path')
const async = require('async')
const onStreamEnd = require('end-of-stream')
const levelUp = require('levelUp')
const levelDown = require('leveldown')
const LevelMiddlewareFactory = require('level-middleware')
const ethUtil = require('ethereumjs-util')
const VM = require('ethereumjs-vm')
const RLP = require('rlp')
const Blockchain = require('ethereumjs-blockchain')
const syncVm = require('ethereumjs-rpc-sync')
const EthSecureTrie = require('merkle-patricia-tree/secure.js')
const EthTrieNode = require('merkle-patricia-tree/trieNode')
const IpfsRepo = require('ipfs-repo')
const IpfsRepoStore = require('fs-pull-blob-store')
const BlockService = require('ipfs-block-service')
const IpfsBlock = require('ipfs-block')
const IpldBlockResolver = require('ipld-eth-block')
const IpldBlockListResolver = require('ipld-eth-block-list')
const IpldEthStateTrieResolver = require('js-ipld-eth-state-trie')
const IpldDown = require('./ipld-down.js')
const IpldEthBlockDown = require('./ipld-eth-block-down')


// let repoPath = pathUtil.resolve('./ipfs')
let repoPath = pathUtil.join(process.env.HOME, '/.jsipfs')
let ipfsRepo = new IpfsRepo(repoPath, { stores: IpfsRepoStore })
let blockService = new BlockService(ipfsRepo)
let headBlockNumber = process.argv[2] && parseInt(process.argv[2])

let nodeGets = 0
let nodePuts = 0

let DbSpy = LevelMiddlewareFactory({
  get: (key, cb) => {
    nodeGets++
    console.log('db get:', key.toString('hex'))
    cb(null, key)
  },
  put: (key, value, cb) => {
    nodePuts++
    // let trieNode = new EthTrieNode(RLP.decode(value))
    // // console.log('db put value:', value)
    // console.log('db put node:', trieNode.type)
    console.log('db put:', key)
    // console.log('db put:', key.toString('hex').slice(0,4), '<-', value.toString('hex'))
    cb(null, key, value)
  }
})

// let stateDb = levelUp('', { db: () => DbSpy(new IpldDown({ codec: 'eth-state-trie', blockService })) })
// let storageDb = levelUp('', { db: () => DbSpy(new IpldDown({ codec: 'eth-storage-trie', blockService })) })
// let blockchainDb = levelUp('./blockchainDb', { db: (loc) => DbSpy(levelDown(loc)) })

let stateDb = levelUp('', { db: () => new IpldDown({ codec: 'eth-state-trie', blockService }) })
let storageDb = levelUp('', { db: () => new IpldDown({ codec: 'eth-storage-trie', blockService }) })
// let blockDb = levelUp('', { db: () => new IpldDown({ codec: 'eth-block', blockService }) })
let blockDb = levelUp('', { db: () => new IpldEthBlockDown({ blockService }) })
let blockchainDb = levelUp('./blockchainDb', { db: levelDown })
let iteratorDb = levelUp('./iteratorDb', { db: levelDown })

let stateTrie = new EthSecureTrie(stateDb)

// stateTrie.put = (key, value, cb) => {
//   console.log('trie.put -', key, value)
//   EthSecureTrie.prototype.put.call(stateTrie, key, value, cb)
// }
// stateTrie.get = (key, opts, cb) => {
//   console.log('trie.get -', key)
//   EthSecureTrie.prototype.get.call(stateTrie, key, opts, cb)
// }

let blockchain = new Blockchain({
  blockDb: blockDb,
  detailsDb: blockchainDb,
  validate: false,
})
let vm = new VM({
  blockchain: blockchain,
  state: stateTrie,
})

// setup account storage trie handling
vm.stateManager._lookupStorageTrie = createAccountStorageTrie
function createAccountStorageTrie (address, cb) {
  vm.stateManager.getAccount(address, function (err, account) {
    if (err) return cb(err)
    let storageTrie = new EthSecureTrie(stateDb, root)
    storageTrie.root = account.stateRoot
    cb(null, storageTrie)
  })
}

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
  setupLogging(vm)
  setupStateDumping(vm)
  setupHeadTracking(vm)

  // setupDbLogging(vm)
})

// validation

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

// dump chain data

function setupStateDumping(vm){
  let lastBlock
  vm.on('beforeBlock', function (block) {
    lastBlock = block
    redundantNodes = 0
    totalNodes = 0
  })
  vm.on('afterBlock', function (results, done) {
    done()
    // console.log('dump block:', lastBlock.header)
    // async.parallel([
    //   // put ommers
    //   (cb) => putOmmerList(lastBlock, cb),
    //   // put txTrie
    //   // - skip -
    //   // put txReceiptTrie
    //   // - skip -
    // // ], done)
    // ], (err, results) => {
    //   if (err) throw err
    //   // console.log('blockCid:', blockCid.toBaseEncodedString())
    //   let ommerCid = results[0]
    //   console.log('ommerCid:', ommerCid.toBaseEncodedString())
    //   done()
    // })
  })
}

// ipld eth chaindata dumpers

function putOmmerList(ethBlock, cb){
  let rawUncles = ethBlock.uncleHeaders.map((uncleHeader) => uncleHeader.raw)
  let serialized = RLP.encode(rawUncles)
  let ipldObj = new IpfsBlock(serialized)
  IpldBlockListResolver.util.cid(rawUncles, (err, cid) => {
    if (err) return cb(err)
    blockService.put({ block: ipldObj, cid: cid }, (err) => {
      if (err) return cb(err)
      cb(null, cid)
    })
  })
}

// head tracking

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

// logging

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

function setupDbLogging(vm){
  let lastBlock, blockNumber, blockHash
  vm.on('beforeBlock', function (block) {
    lastBlock = block
    blockNumber = ethUtil.bufferToInt(lastBlock.header.number)
    blockHash = ethUtil.bufferToHex(lastBlock.hash())
    console.log('gets:',nodeGets)
    console.log('puts:',nodePuts)
    nodeGets = 0
    nodePuts = 0
  })
  vm.on('afterBlock', function (results) {
    // console.log('gets:',nodeGets)
    // console.log('puts:',nodePuts)
  })
}