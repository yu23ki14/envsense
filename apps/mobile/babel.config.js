// Babel 設定。
// react-native-unistyles は v3 で Babel プラグインが必須
// （ShadowNode と Unistyles をバインドするためのコード変換を行う）。
// root はアプリコードのディレクトリで、ここを起点にファイルが変換される。
// https://www.unistyl.es/v3/other/babel-plugin/
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [['react-native-unistyles/plugin', { root: 'src' }]],
  };
};
