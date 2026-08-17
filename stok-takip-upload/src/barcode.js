const bwipjs = require('bwip-js');

function makeBarcode(text, opts = {}) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer({
      bcid: 'code128',
      text: String(text),
      scale: opts.scale || 4,
      height: opts.height || 14,
      includetext: false,
      paddingwidth: opts.paddingwidth || 24,
      paddingheight: opts.paddingheight || 16
    }, (err, png) => {
      if (err) return reject(new Error('Barkod üretilemedi: ' + err.message));
      resolve(png);
    });
  });
}

module.exports = { makeBarcode };