exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('clients', {
    address: { type: 'text', default: null },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('clients', 'address');
};
