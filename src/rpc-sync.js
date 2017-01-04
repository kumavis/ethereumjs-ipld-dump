const async = require('async')
const ethUtil = require('ethereumjs-util')

const rpcToBlock = require('./materialize-block.js')
// const rpcToBlock = require('ethereumjs-block/from-rpc.js')


module.exports = syncVm

function syncVm(vm, opts){
  opts = opts || {}

  let provider = opts.provider
  let startBlockNumber = opts.startBlock || 0
  let lastBlock = null
  let blockNumber = null
  let blockHash = null
  let blockSyncNumber = startBlockNumber
  startBlockchainSync()

  return


  function startBlockchainSync(){
    async.series([
      setGenesis,
      runBlockchain,
    ], function(err){ if (err) throw err })
  }

  function runBlockchain(cb){
    async.forever(function(cb){
      // var blockNumber = ethUtil.bufferToInt(block.header.number)
      // console.log(`at block #${blockSyncNumber}, getting next`)
      downloadBlock(blockSyncNumber+1, function(err, block){
        if (err) return cb(err)
        // console.log(`got block:\n`, describeBlock(block))
        addBlockToChain(block, cb)
      })
    }, cb)
  }

  function setGenesis(cb){
    vm.stateManager.generateCanonicalGenesis(cb)
  }

  function addBlockToChain(block, cb){
    var blockNumber = ethUtil.bufferToInt(block.header.number)
    var isGenesis = (blockNumber === 0)
    async.series([
      (cb) => vm.stateManager.blockchain.putBlock(block, cb, isGenesis),
      (cb) => runBlock(block, cb),
      (cb) => { blockSyncNumber++; cb() },
    ], cb)
  }

  function getBlockByNumber(num, cb){
    performRpcRequest({
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_getBlockByNumber',
      params: [ethUtil.intToHex(num), true],
    }, function(err, res){
      if (err) return cb(err)
      cb(null, res.result)
    })
  }

  function getUncleByBlockHashAndIndex(hash, index, cb){
    performRpcRequest({
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_getUncleByBlockHashAndIndex',
      params: [hash, ethUtil.intToHex(index)],
    }, function(err, res){
      if (err) return cb(err)
      cb(null, res.result)
    })
  }

  function performRpcRequest(payload, cb){
    provider.sendAsync(payload, (err, res) => {
      // console.log(payload, '->', err || res)
      if (err) return cb(err)
      cb(null, res)
    })
  }

  function downloadBlock(num, cb){
    getBlockByNumber(num, function(err, blockParams){
      if (err) return cb(err)
      async.map(blockParams.uncles, function lookupUncle(uncleHash, cb){
        var uncleIndex = blockParams.uncles.indexOf(uncleHash)
        getUncleByBlockHashAndIndex(blockParams.hash, uncleIndex, cb)
      }, function(err, uncles){
        if (err) return cb(err)
        var block = rpcToBlock(blockParams, uncles)
        cb(null, block)
      })
    })
  }

  // run block, update head if valid
  function runBlock (block, cb) {
    vm.stateManager.blockchain.getBlock(block.header.parentHash, function (err, parentBlock) {
      if (err) return cb(err)
      let parentState = parentBlock.header.stateRoot
      // console.log('start-root', vm.stateManager.trie.root.toString('hex'))
      vm.runBlock({
        block: block,
        root: parentState
      }, function (err, results) {
        if (err) {
          console.log('ERROR - runBlock:', err)
          return cb(err)
        }
        // console.log('vm results:', results)
        cb()
      })
    })
  }
}

function describeBlock(block){
  return {
    number: ethUtil.bufferToHex(block.header.number),
    mixHash: ethUtil.bufferToHex(block.header.mixHash),
    parentHash: ethUtil.bufferToHex(block.header.parentHash),
    nonce: ethUtil.bufferToHex(block.header.nonce),
    uncleHash: ethUtil.bufferToHex(block.header.uncleHash),
    bloom: ethUtil.bufferToHex(block.header.bloom),
    transactionsTrie: ethUtil.bufferToHex(block.header.transactionsTrie),
    stateRoot: ethUtil.bufferToHex(block.header.stateRoot),
    receiptTrie: ethUtil.bufferToHex(block.header.receiptTrie),
    coinbase: ethUtil.bufferToHex(block.header.coinbase),
    difficulty: ethUtil.bufferToHex(block.header.difficulty),
    extraData: ethUtil.bufferToHex(block.header.extraData),
    gasLimit: ethUtil.bufferToHex(block.header.gasLimit),
    gasUsed: ethUtil.bufferToHex(block.header.gasUsed),
    timestamp: ethUtil.bufferToHex(block.header.timestamp),
  }
}