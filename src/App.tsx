import React, { useEffect, useState } from 'react';
import {
    BroadcastedTransaction,
    getContract,
    IWBTCContract,
    JSONRpcProvider,
    WBTC_ABI,
} from 'opnet';

import './App.css';
import {
    AddressVerificator,
    EcKeyPair,
    IInteractionParameters,
    InteractionParametersWithoutSigner,
    OPNetLimitedProvider,
    TransactionFactory,
    UnisatSigner,
    wBTC as WrappedBitcoin,
} from '@btc-vision/transaction';
import * as networks from 'bitcoinjs-lib/src/networks';
import { Address } from '@btc-vision/bsi-binary';
import { FetchUTXOParamsMultiAddress } from '@btc-vision/transaction/src/utxo/interfaces/IUTXO.js';

/* global BigInt */

const API_URL = 'https://regtest.opnet.org';
const provider = new JSONRpcProvider(API_URL);

const utxoManager = new OPNetLimitedProvider(API_URL);
const factory = new TransactionFactory();

const network = networks.regtest;
const wrappedBitcoin = new WrappedBitcoin(network);

let contract: IWBTCContract = getContract<IWBTCContract>(
    wrappedBitcoin.getAddress(),
    WBTC_ABI,
    provider,
);

function convertSatoshisToBTC(satoshis: bigint): string {
    return (Number(satoshis || 0n) / 100000000)
        .toFixed(7)
        .replace(/([0-9]+(\.[0-9]+[1-9])?)(\.?0+$)/, '$1');
}

function convertBTCtoSatoshis(btc: string): bigint {
    return BigInt(Math.floor(Number(btc) * 100000000));
}

export function App() {
    const [walletAddress, setWalletAddress] = useState<string>('');
    const [balance, setBalance] = useState<bigint>(0n);
    const [error, setError] = useState<string>('');
    const [totalSupply, setSupply] = useState<bigint>(0n);
    const [showModal, setShowModal] = useState<boolean>(false);
    const [wrapAmount, setWrapAmount] = useState<string>('');
    const [transferTo, setTransferTo] = useState<string>('');
    const [feedbackMessage, setFeedbackMessage] = useState<string>('');
    const [feedbackSuccess, setFeedbackSuccess] = useState<boolean>(false);

    const handleWalletConnect = async () => {
        // Logic to connect wallet
        if (typeof window.unisat !== 'undefined') {
            const accounts = await window.unisat.requestAccounts().catch((error) => {
                console.error(error);
            });

            if (accounts) {
                setWalletAddress(accounts[0]);

                // if address is p2tr, set the new contract.
                if (AddressVerificator.isValidP2TRAddress(accounts[0], network)) {
                    contract = getContract<IWBTCContract>(
                        wrappedBitcoin.getAddress(),
                        WBTC_ABI,
                        provider,
                        accounts[0],
                    );
                }

                await fetchBalance(accounts[0]);
            }
        } else {
            setFeedbackMessage(
                'Unsupported wallet extension detected. Please install Unisat or Xverse.',
            );

            setFeedbackSuccess(false);
        }
    };

    async function getWBTCBalance(address: Address): Promise<bigint> {
        const result = await contract.balanceOf(address);
        if ('error' in result) throw new Error('Something went wrong');

        const properties: { balance: bigint } = result.properties as { balance: bigint };
        return properties.balance || 0n;
    }

    async function fetchSupply() {
        const totalSupply = await contract.totalSupply();

        if ('error' in totalSupply) {
            return setError('Something went wrong while fetching the total supply');
        }

        const properties: { totalSupply: bigint } = totalSupply.properties as {
            totalSupply: bigint;
        };

        const supply = properties.totalSupply;
        setSupply(supply);
    }

    async function fetchBalance(address: Address): Promise<void> {
        if (!address) return setError('Please enter a valid wallet address');

        try {
            const balance = await getWBTCBalance(address);
            setBalance(balance);
        } catch (err) {
            const error = err as Error;

            console.log('problem fetching balance', error, contract);
            setError(error.message);
        }
    }

    useEffect(() => {
        void fetchSupply();
    }, []);

    setTimeout(() => {
        void fetchSupply();
    }, 30000);

    const handleWrapBitcoin = () => {
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
    };

    const handleConfirmWrap = async () => {
        if (!wrapAmount || !transferTo) {
            setFeedbackMessage('Please fill in all fields.');
            setFeedbackSuccess(false);
            return;
        }

        // verify if the address is valid
        if (!EcKeyPair.verifyContractAddress(transferTo, network)) {
            setFeedbackMessage('Invalid transfer address.');
            setFeedbackSuccess(false);
            return;
        }

        if (!window.unisat) {
            setFeedbackMessage(
                'Oops, unsupported wallet extension detected. Please install Unisat or Xverse.',
            );
            setFeedbackSuccess(false);
            return;
        }

        // Perform action and set feedback message
        try {
            const keypair = new UnisatSigner();
            await keypair.init();

            if (!AddressVerificator.isValidP2TRAddress(keypair.p2tr, network)) {
                setFeedbackMessage(
                    'Invalid network. Please make sure you are on the right network.',
                );

                setFeedbackSuccess(false);
                return;
            }

            contract = getContract<IWBTCContract>(
                wrappedBitcoin.getAddress(),
                WBTC_ABI,
                provider,
                keypair.p2tr,
            );

            const requiredBalance = convertBTCtoSatoshis(wrapAmount);
            const currentBalance = await getWBTCBalance(keypair.p2tr); //wallet.p2tr

            if (currentBalance < requiredBalance) {
                setFeedbackMessage(
                    `Oops! Insufficient funds! You only have ${convertSatoshisToBTC(
                        currentBalance,
                    )} wBTC. You need ${wrapAmount} wBTC to proceed.`,
                );
                setFeedbackSuccess(false);
                return;
            }

            const utxoSetting: FetchUTXOParamsMultiAddress = {
                addresses: keypair.addresses,
                minAmount: 10_000n,
                requestedAmount: 100_000n,
            };

            const utxos = await utxoManager.fetchUTXOMultiAddr(utxoSetting);
            if (!utxos || !utxos.length) {
                setFeedbackMessage('Insufficient funds.');
                setFeedbackSuccess(false);
                return;
            }

            const call = await contract.transfer(transferTo, requiredBalance);
            if ('error' in call) {
                setFeedbackMessage(
                    `Could not create transaction. Simulation failed. ${call.error}`,
                );

                setFeedbackSuccess(false);
                return;
            }

            const calldata = call.calldata;
            if (!calldata) {
                setFeedbackMessage('Something went wrong. Please try again.');
                setFeedbackSuccess(false);
                return;
            }

            console.log('Estimated gas', call.estimatedGas);

            const interactionParameters: InteractionParametersWithoutSigner = {
                from: keypair.p2tr, //wallet.p2wpkh,
                to: wrappedBitcoin.getAddress(),
                utxos: utxos,
                //signer: keypair, //wallet.keypair,
                network: keypair.network,
                feeRate: 450,
                priorityFee: 10000n,
                calldata: calldata,
            };

            let broadcastedTxs: [BroadcastedTransaction, BroadcastedTransaction];
            if (!window.unisat.web3) {
                const interactionParameter: IInteractionParameters = {
                    ...interactionParameters,
                    signer: keypair,
                };

                const finalTx = await factory.signInteraction(interactionParameter);

                if (!finalTx) {
                    setFeedbackMessage('Transaction failed.');
                    setFeedbackSuccess(false);
                    return;
                }

                const broadcastTxA = await provider.sendRawTransaction(finalTx[0], false);
                if (!broadcastTxA.result) {
                    setFeedbackMessage('Transaction failed.');
                    setFeedbackSuccess(false);
                    return;
                }

                const broadcastTxB = await provider.sendRawTransaction(finalTx[1], false);
                if (!broadcastTxB.result) {
                    setFeedbackMessage('Transaction failed.');
                    setFeedbackSuccess(false);
                    return;
                }

                broadcastedTxs = [broadcastTxA, broadcastTxB];
            } else {
                broadcastedTxs = await window.unisat.web3.signInteraction(interactionParameters);
            }

            const broadcastTxA = broadcastedTxs[0];
            const broadcastTxB = broadcastedTxs[1];

            if (
                broadcastTxA &&
                broadcastTxB &&
                broadcastTxB.result &&
                broadcastTxA.result &&
                broadcastTxB.peers
            ) {
                setFeedbackMessage(
                    `Successfully transferred ${wrapAmount} wBTC to ${transferTo}. Transaction ID: ${
                        broadcastTxB.result
                    }. Broadcasted to ${broadcastTxB.peers + 1} peer(s).`,
                );
                setFeedbackSuccess(true);
            } else {
                setFeedbackMessage('Something went wrong. Please try again.');

                setFeedbackSuccess(false);
            }
        } catch (error) {
            console.log('Something went wrong', error);
            // If error occurs, set error message
            setFeedbackMessage('Something went wrong. Please try again.');
            setFeedbackSuccess(false);
        }
    };

    return (
        <div className="app-container">
            <h1 className="main-title">Wrapped Bitcoin</h1>
            <div className="total-supply">
                <h3>
                    Total Supply:{' '}
                    {totalSupply !== null ? convertSatoshisToBTC(totalSupply) : 'Loading...'} wBTC
                </h3>
            </div>
            <div className="app">
                <header className="header">
                    <h2 className="title">wBTC Balance Checker</h2>
                </header>
                <button
                    onClick={handleWalletConnect}
                    className="button">
                    Connect Wallet
                </button>
                <br />
                {walletAddress && (
                    <h3 className="balance small-font">
                        Connected wallet: {walletAddress.slice(0, 32)}...
                    </h3>
                )}
                {/* <form onSubmit={handleSubmit} className='form'>
                    <label htmlFor="wallet" className='label'>Enter your wallet:</label>
                    <input
                        type="text"
                        id="wallet"
                        value={walletAddress}
                        onChange={handleChange}
                        className='input'
                        placeholder="Enter Bitcoin wallet address"
                    />
                    <button type="submit" className='button'>Check Balance</button>
                </form> */}
                {/*<br />
                 <button
                    onClick={handleWrapBitcoin}
                    className="purple-button">
                    Wrap Your Bitcoin
                </button>
                <br /> */}
                <br />
                <button
                    onClick={handleWrapBitcoin}
                    className="purple-button">
                    Transfer Wrapped Bitcoin
                </button>
                {balance !== 0n && (
                    <h1 className="balance">You have {convertSatoshisToBTC(balance)} wBTC</h1>
                )}
                {error && <p className="error">Error: {error}</p>}

                {/* Modal */}
                {showModal && (
                    <div className="modal">
                        <div className="modal-content">
                            <span
                                className="close"
                                onClick={handleCloseModal}>
                                &times;
                            </span>
                            <h2>Transfer wBTC</h2>
                            <div className="input-group">
                                <label htmlFor="wrapAmount">Amount to transfer:</label>
                                <input
                                    type="text"
                                    id="wrapAmount"
                                    value={wrapAmount}
                                    onChange={(e) => setWrapAmount(e.target.value)}
                                />
                            </div>
                            <div className="input-group">
                                <label htmlFor="transferTo">Transfer to (p2tr address):</label>
                                <input
                                    type="text"
                                    id="transferTo"
                                    value={transferTo}
                                    onChange={(e) => setTransferTo(e.target.value)}
                                />
                            </div>
                            {feedbackMessage && (
                                <p
                                    className={
                                        feedbackSuccess ? 'success-message' : 'error-message'
                                    }>
                                    {feedbackMessage}
                                </p>
                            )}
                            <button
                                className="purple-button"
                                onClick={handleConfirmWrap}>
                                Confirm
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
