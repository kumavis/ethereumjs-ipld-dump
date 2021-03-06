const Block = require('ethereumjs-block')
const Transaction = require('ethereumjs-tx')
const ethUtil = require('ethereumjs-util')
const HOMESTEAD_BLOCK_NUMBER = 1150000

module.exports = blockFromRpc

/**
 * Creates a new block object from Ethereum JSON RPC.
 * @param {Object} blockParams - Ethereum JSON RPC of block (eth_getBlockByNumber)
 * @param {Array.<Object>} Optional list of Ethereum JSON RPC of uncles (eth_getUncleByBlockHashAndIndex)
 */
function blockFromRpc (blockParams, uncles) {
  uncles = uncles || []
  var block = new Block({
    transactions: [],
    uncleHeaders: []
  })
  var blockHeader = block.header
  blockHeader.parentHash = blockParams.parentHash
  blockHeader.uncleHash = blockParams.sha3Uncles
  blockHeader.coinbase = blockParams.miner
  blockHeader.stateRoot = blockParams.stateRoot
  blockHeader.transactionsTrie = blockParams.transactionsRoot
  blockHeader.receiptTrie = blockParams.receiptRoot || blockParams.receiptsRoot || ethUtil.SHA3_NULL
  blockHeader.bloom = blockParams.logsBloom
  blockHeader.difficulty = blockParams.difficulty
  blockHeader.number = blockParams.number
  blockHeader.gasLimit = blockParams.gasLimit
  blockHeader.gasUsed = blockParams.gasUsed
  blockHeader.timestamp = blockParams.timestamp
  blockHeader.extraData = blockParams.extraData
  blockHeader.mixHash = blockParams.mixHash
  blockHeader.nonce = blockParams.nonce

  // override hash incase something was missing
  blockHeader.hash = function () {
    return ethUtil.toBuffer(blockParams.hash)
  }

  block.transactions = (blockParams.transactions || []).map(function (_txParams) {
    var txParams = Object.assign({}, _txParams)
    normalizeTxParams(txParams)
    var tx
    try {
      tx = new Transaction(txParams)
    } catch (err) {
      console.warn('Error while constructing transaction:', err)
      console.warn('rpc:', _txParams)
      console.warn('normalized:', txParams)
      process.exit()
    }
    tx._homestead = (parseInt(txParams.blockNumber) >= HOMESTEAD_BLOCK_NUMBER)
    return tx
  })
  block.uncleHeaders = uncles.map(function (uncleParams) {
    return blockFromRpc(uncleParams).header
  })

  return block
}

function normalizeTxParams (txParams) {
  // hot fix for https://github.com/ethereumjs/ethereumjs-util/issues/40
  txParams.gasLimit = (txParams.gasLimit === undefined) ? txParams.gas : txParams.gasLimit
  txParams.data = (txParams.data === undefined) ? txParams.input : txParams.data
  // strict byte length checking
  txParams.to = txParams.to ? ethUtil.setLengthLeft(ethUtil.toBuffer(txParams.to), 20) : null
  // v as raw signature value {0,1}
  txParams.v = txParams.v < 27 ? txParams.v + 27 : txParams.v
  delete txParams.from
}