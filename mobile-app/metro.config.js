const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// SVG transformer: treat .svg as source (component), not as asset
// Use expo-specific entry point for SDK 50+
config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer/expo')
config.resolver.assetExts = config.resolver.assetExts.filter(ext => ext !== 'svg')
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg']

module.exports = config
