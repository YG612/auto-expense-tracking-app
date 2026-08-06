/* global jest */

jest.mock('react-native-safe-area-context', () => {
  const safeAreaMock = jest.requireActual(
    'react-native-safe-area-context/jest/mock',
  );

  return safeAreaMock.default;
});
