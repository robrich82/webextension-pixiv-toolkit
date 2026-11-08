/**
 * babel-loader's config for src/ in the webpack builds. Tests run on Vitest,
 * which transforms with Vite instead.
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
  ]
};
