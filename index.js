import { JSONRpcProvider, version } from "opnet";

console.log(version);

//
const provider = new JSONRpcProvider('http://192.168.50.136:9001');
const payload = provider.buildJsonRpcPayload('btc_generate', [1, 330, 'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn']);

async function fetch() {
    const start = Date.now();
    const promises = [];

    for (let i = 0; i < 1; i++) {
        const result = provider.callPayloadSingle(payload);
        promises.push(result);
    }

    await Promise.all(promises);

    console.log('Time taken:', Date.now() - start);
}


setInterval(() => {
    fetch();
}, 1);
