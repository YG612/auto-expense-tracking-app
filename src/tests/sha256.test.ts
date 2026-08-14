import { sha256 } from '../utils/sha256';

describe('sha256', () => {
  it('matches standard ASCII and UTF-8 vectors', () => {
    expect(sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256('轻记 AI')).toBe(
      '2a4b3a5af0795e08ca3aa89d77fc4395a90c45591fe7552d75b6186a945ba3a1',
    );
  });
});
