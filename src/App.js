import React, { useEffect, useState } from 'react';
import { getContract, JSONRpcProvider } from "opnet";

import './App.css';
import { wBTC } from "./metadata/wBTC";
import { EcKeyPair, OPNetLimitedProvider, TransactionFactory, Wallet } from "@btc-vision/transaction";
import { Buffer } from 'buffer/';
import * as networks from 'bitcoinjs-lib/src/networks';
import { ABICoder, BinaryWriter } from '@btc-vision/bsi-binary';

const provider = new JSONRpcProvider('https://testnet.opnet.org');

/* global BigInt */

function convertSatoshisToBTC(satoshis) {
    return (Number(satoshis || 0n) / 100000000).toFixed(7).replace(/([0-9]+(\.[0-9]+[1-9])?)(\.?0+$)/, '$1');
}

function convertBTCtoSatoshis(btc) {
    return BigInt(Math.floor(Number(btc) * 100000000));
}

const utxoManager = new OPNetLimitedProvider('https://testnet.opnet.org');
const factory = new TransactionFactory();

const abiCoder = new ABICoder();
const transferSelector = Number(`0x` + abiCoder.encodeSelector('transfer'));

const network = networks.testnet;

const contract = getContract(
    'tb1qv9hnnf8ymsr6mr5lwa4jmqqtwrjs5t09pa83wq',
    wBTC,
    provider,
);

function getTransferToCalldata(to, amount) {
    const addCalldata = new BinaryWriter();
    addCalldata.writeSelector(transferSelector);
    addCalldata.writeAddress(to);
    addCalldata.writeU256(amount);

    const uint = addCalldata.getBuffer();

    return Buffer.from(uint);
}

export function App() {
    const [walletAddress, setWalletAddress] = useState('');
    const [balance, setBalance] = useState(0);
    const [error, setError] = useState(null);
    const [totalSupply, setSupply] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [bitcoinWIF, setBitcoinWIF] = useState('');
    const [wrapAmount, setWrapAmount] = useState('');
    const [transferTo, setTransferTo] = useState('');
    const [feedbackMessage, setFeedbackMessage] = useState('');
    const [feedbackSuccess, setFeedbackSuccess] = useState(false);

    async function getWBTCBalance(address) {
        const result = await contract.balanceOf(address);
        if ('error' in result) throw new Error('Something went wrong');

        const properties = result.properties;
        return properties.balance || 0n;
    }

    async function fetchSupply() {
        const totalSupply = await contract.totalSupply();

        if ('error' in totalSupply) {
            return setError('Something went wrong while fetching the total supply');
        }

        const properties = totalSupply.properties;
        const supply = properties.supply;

        setSupply(supply);
    }

    async function fetchBalance(address) {
        if (!address) return setError('Please enter a valid wallet address');

        try {
            const balance = await getWBTCBalance(address);
            setBalance(balance);
        } catch (err) {
            console.log(err, contract);
            setError(err.message);
        }
    }

    useEffect(() => {
        void fetchSupply();
    }, []);

    setTimeout(() => {
        void fetchSupply();
    }, 30000);

    const handleChange = (e) => {
        setWalletAddress(e.target.value);
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        setError(null);
        setBalance(0);
        void fetchBalance(walletAddress);
    };

    const handleWrapBitcoin = () => {
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
    };

    const handleConfirmWrap = async () => {
        if (!bitcoinWIF || !wrapAmount || !transferTo) {
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

        // Perform action and set feedback message
        try {
            const keypair = EcKeyPair.fromWIF(bitcoinWIF, network);
            const wallet = new Wallet({
                privateKey: bitcoinWIF,
                address: EcKeyPair.getTaprootAddress(keypair, network),
                publicKey: keypair.publicKey.toString('hex')
            }, network);

            const requiredBalance = convertBTCtoSatoshis(wrapAmount);
            const currentBalance = await getWBTCBalance(wallet.p2tr);
            if (currentBalance < requiredBalance) {
                setFeedbackMessage(`Oops! Insufficient funds! You only have ${convertSatoshisToBTC(currentBalance)} wBTC. You need ${wrapAmount} wBTC to proceed.`);
                setFeedbackSuccess(false);
                return;
            }

            console.log(`Current balance: ${currentBalance}`)

            const utxoSetting = {
                address: wallet.p2wpkh,
                minAmount: 10000n,
                requestedAmount: 100000n,
            };

            const utxos = await utxoManager.fetchUTXO(utxoSetting);
            if (!utxos) {
                setFeedbackMessage('Insufficient funds.');
                setFeedbackSuccess(false);
                return;
            }


            const calldata = getTransferToCalldata(
                transferTo,
                requiredBalance
            );

            const interactionParameters = {
                from: wallet.p2wpkh,
                to: 'tb1pq64lx73fwyrdp4asvl7xt5r5qvxvt9wy82x75taqtzvd64f58nasansurj',
                utxos: utxos,
                signer: wallet.keypair,
                network: network,
                feeRate: 450,
                priorityFee: 50000n,
                calldata: calldata,
            };

            const finalTx = factory.signInteraction(interactionParameters);
            if (!finalTx) {
                setFeedbackMessage('Transaction failed.');
                setFeedbackSuccess(false);
                return;
            }

            const broadcastTxA = await provider.sendRawTransaction(finalTx[0], false);
            if (!broadcastTxA) {
                setFeedbackMessage('Transaction failed.');
                setFeedbackSuccess(false);
                return;
            }

            const broadcastTxB = await provider.sendRawTransaction(finalTx[1], false);
            if (!broadcastTxB) {
                setFeedbackMessage('Transaction failed.');
                setFeedbackSuccess(false);
                return;
            }

            if (broadcastTxA && broadcastTxB && broadcastTxA.success && broadcastTxB.success) {
                setFeedbackMessage(`Successfully transferred ${wrapAmount} wBTC to ${transferTo}. Transaction ID: ${broadcastTxB.result}. Broadcasted to ${broadcastTxB.peers + 1} peer(s).`)
                setFeedbackSuccess(true);
            } else {
                setFeedbackMessage('Something went wrong. Please try again.');

                setFeedbackSuccess(false);
            }
        } catch (error) {
            console.error(error);
            // If error occurs, set error message
            setFeedbackMessage('Something went wrong. Please try again.');
            setFeedbackSuccess(false);
        }
    };

    return (
        <div className='app-container'>
            <h1 className='main-title'>Wrapped Bitcoin</h1>
            <div className='total-supply'>
                <h3>Total Supply: {totalSupply !== null ? convertSatoshisToBTC(totalSupply) : 'Loading...'} wBTC</h3>
            </div>
            <div className='app'>
                <header className='header'>
                    <h2 className='title'>wBTC Balance Checker</h2>
                </header>
                <form onSubmit={handleSubmit} className='form'>
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
                </form>
                <br/>
                <button onClick={handleWrapBitcoin} className='purple-button'>Transfer Wrapped Bitcoin</button>
                {balance !== 0 && (
                    <h1 className='balance'>You have {convertSatoshisToBTC(balance)} wBTC</h1>
                )}
                {error && (
                    <p className='error'>Error: {error}</p>
                )}

                {/* Modal */}
                {showModal && (
                    <div className="modal">
                        <div className="modal-content">
                            <span className="close" onClick={handleCloseModal}>&times;</span>
                            <h2>Transfer wBTC</h2>
                            <div className="input-group">
                                <label htmlFor="bitcoinWIF">Bitcoin WIF (private key):</label>
                                <input type="text" id="bitcoinWIF" value={bitcoinWIF}
                                       onChange={(e) => setBitcoinWIF(e.target.value)}/>
                            </div>
                            <div className="input-group">
                                <label htmlFor="wrapAmount">Amount to transfer:</label>
                                <input type="text" id="wrapAmount" value={wrapAmount}
                                       onChange={(e) => setWrapAmount(e.target.value)}/>
                            </div>
                            <div className="input-group">
                                <label htmlFor="transferTo">Transfer to (p2tr address):</label>
                                <input type="text" id="transferTo" value={transferTo}
                                       onChange={(e) => setTransferTo(e.target.value)}/>
                            </div>
                            {feedbackMessage && (
                                <p className={feedbackSuccess ? 'success-message' : 'error-message'}>{feedbackMessage}</p>
                            )}
                            <button className='purple-button' onClick={handleConfirmWrap}>Confirm</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
