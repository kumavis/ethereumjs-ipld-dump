const pathUtil = require('path')
const async = require('async')
const now = require('performance-now')
const levelUp = require('levelup')
const levelDown = require('leveldown')
const LevelMiddlewareFactory = require('level-middleware')
const ethUtil = require('ethereumjs-util')
const VM = require('ethereumjs-vm')
const RLP = require('rlp')
const Blockchain = require('ethereumjs-blockchain')
const EthSecureTrie = require('merkle-patricia-tree/secure.js')
const IpfsRepo = require('ipfs-repo')
const IpfsRepoStore = require('fs-pull-blob-store')
const BlockService = require('ipfs-block-service')
const IpfsBlock = require('ipfs-block')
// const syncVm = require('ethereumjs-rpc-sync')
const syncVm = require('./rpc-sync')
const HttpProvider = require('ethjs-provider-http')
const IpldDown = require('./ipld-down.js')
const IpldEthBlockDown = require('./ipld-eth-block-down')


let repoPath = process.env.IPFS_REPO || pathUtil.join(process.env.HOME, '/.jsipfs')
let dbRoot = process.env.DB_ROOT || process.cwd()
let ipfsRepo = new IpfsRepo(repoPath, { stores: IpfsRepoStore })
let blockService = new BlockService(ipfsRepo)
let headBlockNumber = process.argv[2] && parseInt(process.argv[2])

let nodeGets = 0
let nodePuts = 0


let stateDb = levelUp('', { db: () => new IpldDown({ codec: 'eth-state-trie', blockService }) })
let storageDb = levelUp('', { db: () => new IpldDown({ codec: 'eth-storage-trie', blockService }) })
let blockDb = levelUp('', { db: () => new IpldEthBlockDown({ blockService }) })
let blockchainDb = levelUp(pathUtil.join(dbRoot, './blockchainDb'), { db: levelDown })
let iteratorDb = levelUp(pathUtil.join(dbRoot, './iteratorDb'), { db: levelDown })

let stateTrie = new EthSecureTrie(stateDb)

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
    let storageTrie = new EthSecureTrie(stateDb, account.stateRoot)
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

  console.log('rpc target:', process.env.RPC_TARGET || 'http://localhost:8545')
  let provider = new HttpProvider(process.env.RPC_TARGET || 'http://localhost:8545')
  syncVm(vm, {
    provider: provider,
    startBlock: startBlockNumber,
  })
  setupStateRootChecking(vm)
  setupLogging(vm)
  setupHeadTracking(vm)
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

let startTime = now()
let startBlockNumber
function setupLogging(vm){
  let lastBlock, blockNumber, blockHash
  vm.on('beforeBlock', function (block) {
    // log block number
    lastBlock = block
    blockNumber = ethUtil.bufferToInt(lastBlock.header.number)
    blockHash = ethUtil.bufferToHex(lastBlock.hash())
    var paddedBlockNumber = ('          ' + blockNumber).slice(-8)
    var out = `#${paddedBlockNumber} ${blockHash} txs: ${block.transactions.length}`
    console.log(out)
    // log block rate
    if (!startBlockNumber) startBlockNumber = blockNumber
    let processedBlocks = blockNumber - startBlockNumber
    let secondsElapsed = (now() - startTime)/1e3
    let blockRate = processedBlocks / secondsElapsed
    console.log(`${blockRate.toFixed(2)} blocks/sec`)
  })
}
