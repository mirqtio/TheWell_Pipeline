const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { merge } = require('webpack-merge');

const baseConfig = {
  entry: './src/web/dashboard/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/dashboard'),
    filename: 'js/[name].[contenthash].js',
    publicPath: '/dashboard/',
    clean: true
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: {
      '@': path.resolve(__dirname, 'src/web/dashboard'),
      '@components': path.resolve(__dirname, 'src/web/dashboard/components'),
      '@pages': path.resolve(__dirname, 'src/web/dashboard/pages'),
      '@store': path.resolve(__dirname, 'src/web/dashboard/store'),
      '@hooks': path.resolve(__dirname, 'src/web/dashboard/hooks'),
      '@utils': path.resolve(__dirname, 'src/web/dashboard/utils'),
      '@api': path.resolve(__dirname, 'src/web/dashboard/api'),
      '@types': path.resolve(__dirname, 'src/web/dashboard/types')
    }
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              presets: [
                '@babel/preset-env',
                '@babel/preset-react',
                '@babel/preset-typescript'
              ]
            }
          }
        ]
      },
      {
        test: /\.css$/,
        use: [
          process.env.NODE_ENV === 'production'
            ? MiniCssExtractPlugin.loader
            : 'style-loader',
          'css-loader'
        ]
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'images/[name].[hash][ext]'
        }
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'fonts/[name].[hash][ext]'
        }
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/web/dashboard/index.html',
      title: 'TheWell Pipeline Dashboard',
      favicon: './src/web/public/favicon.ico'
    }),
    new MiniCssExtractPlugin({
      filename: 'css/[name].[contenthash].css'
    })
  ]
};

const developmentConfig = {
  mode: 'development',
  devtool: 'inline-source-map',
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist/dashboard')
    },
    port: 3001,
    hot: true,
    historyApiFallback: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
  }
};

const productionConfig = {
  mode: 'production',
  devtool: 'source-map',
  optimization: {
    minimize: true,
    runtimeChunk: 'single',
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10
        },
        mui: {
          test: /[\\/]node_modules[\\/]@mui[\\/]/,
          name: 'mui',
          priority: 20
        }
      }
    }
  }
};

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  return merge(baseConfig, isProduction ? productionConfig : developmentConfig);
};