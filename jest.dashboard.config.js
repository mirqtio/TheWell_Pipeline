module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests/dashboard'],
  testMatch: [
    '**/*.test.ts',
    '**/*.test.tsx'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/web/dashboard/$1',
    '^@components/(.*)$': '<rootDir>/src/web/dashboard/components/$1',
    '^@pages/(.*)$': '<rootDir>/src/web/dashboard/pages/$1',
    '^@store/(.*)$': '<rootDir>/src/web/dashboard/store/$1',
    '^@hooks/(.*)$': '<rootDir>/src/web/dashboard/hooks/$1',
    '^@utils/(.*)$': '<rootDir>/src/web/dashboard/utils/$1',
    '^@api/(.*)$': '<rootDir>/src/web/dashboard/api/$1',
    '^@types/(.*)$': '<rootDir>/src/web/dashboard/types/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      }
    }]
  },
  setupFilesAfterEnv: ['<rootDir>/jest.dashboard.setup.js'],
  collectCoverageFrom: [
    'src/web/dashboard/**/*.{ts,tsx}',
    '!src/web/dashboard/**/*.d.ts',
    '!src/web/dashboard/index.tsx',
    '!src/web/dashboard/**/*.test.{ts,tsx}',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};