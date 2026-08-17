const bwipjs = require('bwip-js');

function makeBarcode(text, opts = {}) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer({
      bcid: 'code128',
      text: String(text),
      scale: opts.scale || 3,
      height: opts.height || 12,
      includetext: true,
      textxalign: 'center'
    }, (err, png) => {
      if (err) return reject(new Error('Barkod üretilemedi: ' + err.message));
      resolve(png);
    });
  });
}

module.exports = { makeBarcode };