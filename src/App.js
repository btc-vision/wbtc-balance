import React, { useEffect, useState } from 'react';
import { getContract, JSONRpcProvider } from "opnet";

import './App.css';
import { wBTC } from "./metadata/wBTC";

const provider = new JSONRpcProvider('https://testnet.opnet.org');

function convertSatoshisToBTC(satoshis) {
    return (Number(satoshis || 0n) / 100000000).toFixed(7).replace(/([0-9]+(\.[0-9]+[1-9])?)(\.?0+$)/, '$1');
}

export function App() {
    const [walletAddress, setWalletAddress] = useState('');
    const [balance, setBalance] = useState(0);
    const [error, setError] = useState(null);
    const [totalSupply, setSupply] = useState(0);

    const contract = getContract(
        'tb1pq64lx73fwyrdp4asvl7xt5r5qvxvt9wy82x75taqtzvd64f58nasansurj',
        wBTC,
        provider,
    );

    async function fetchSupply() {
        const totalSupply = await contract.totalSupply();

        if ('error' in totalSupply) {
            return setError('Something went wrong while fetching the total supply');
        }

        const properties = totalSupply.properties;
        const supply = properties.supply;

        console.log(properties);

        setSupply(supply);
    }

    async function fetchBalance(address) {
        if (!address) return setError('Please enter a valid wallet address');

        try {
            const result = await contract.balanceOf(address);
            if ('error' in result) throw new Error('Something went wrong');

            const properties = result.properties;
            const balance = properties.balance;
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
                {balance !== 0 && (
                    <h1 className='balance'>You have {convertSatoshisToBTC(balance)} wBTC</h1>
                )}
                {error && (
                    <p className='error'>Error: {error}</p>
                )}
            </div>
        </div>
    )
        ;
}

export default App;
