__squidDefine('src/license/pubkey.js', function (exports) {
'use strict';
// 作者的公钥（ECDSA P-256，只有 x、y，没有私钥部分）。启动码就用它验签；公开没关系，没有私钥伪造不出启动码。
// 私钥在仓库之外（德扑训练器-授权 目录），只在作者自己的电脑上。tools/keycheck.mjs 核对成品里内置的就是这一把。
const PUBLIC_KEY = { kty: 'EC', crv: 'P-256', x: 'eno6MG5uPswmlBq1TGw78gN2vHk148dgqWCey4DO9a8', y: 'gem8zqmu65-CuqBijSGdMC-XUMxhGbWjcMXs19KqqVQ' };

exports.PUBLIC_KEY = PUBLIC_KEY;
});
