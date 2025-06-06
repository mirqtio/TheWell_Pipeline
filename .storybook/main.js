/**
 * Storybook Configuration
 */

module.exports = {
  stories: [
    '../src/web/ui-framework/**/*.stories.@(js|jsx|ts|tsx|mdx)',
    '../src/web/ui-framework/docs/**/*.mdx',
  ],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@storybook/addon-a11y',
    '@storybook/addon-viewport',
    '@storybook/addon-docs',
  ],
  framework: {
    name: '@storybook/react-webpack5',
    options: {},
  },
  docs: {
    autodocs: 'tag',
  },
  staticDirs: ['../src/web/public'],
  webpackFinal: async (config) => {
    // Add CSS loader for our styles
    config.module.rules.push({
      test: /\.css$/,
      use: ['style-loader', 'css-loader'],
      include: /ui-framework/,
    });
    
    return config;
  },
};