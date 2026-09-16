/**
 * A root config (unlike `.babelrc`, which only applies within the package
 * boundary of the file being compiled) is required so Jest's babel-jest
 * transform can reach into node_modules/vuetify -- see jest.config.js's
 * `transformIgnorePatterns` comment for why that's necessary at all.
 */
module.exports = {
  presets: [
    [
      '@babel/preset-env', {
        modules: false
      }
    ]
  ],
  plugins: [
    '@babel/plugin-transform-runtime',
    '@babel/plugin-transform-class-properties'
  ],
  env: {
    test: {
      presets: [
        [
          '@babel/preset-env', {
            targets: { node: 'current' }
          }
        ]
      ],
      plugins: [
        '@babel/plugin-transform-runtime',
        '@babel/plugin-transform-class-properties',
        '@babel/plugin-transform-modules-commonjs'
      ]
    }
  }
};
